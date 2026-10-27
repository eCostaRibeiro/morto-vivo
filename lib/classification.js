// Classificação pura: recebe evidências da rede/DOM e retorna status sem fazer I/O.
import { safeUrl, registrableDomain } from './normalize.js';
import { extractMeta, visibleText, norm } from './text.js';
import { normalizeCustomRuleTerm } from './customRules.js';
import {
  TAKEDOWN, PARKED, DOMAIN_SALE, DOMAIN_SALE_CTA, DOMAIN_PARKING_PROVIDERS,
  SOFT404_TITLE, SOFT404_BODY, CHALLENGE, LOGIN_WALL, defaultAlive,
} from './rules.js';

function classifyTikTokVideo(url, html, meta, mk) {
  const videoId = safeUrl(url)?.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1];
  if (!videoId) return null;
  const stateMatch = html.match(/<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!stateMatch) return null;

  let videoDetail;
  try {
    videoDetail = JSON.parse(stateMatch[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
  } catch {
    return null;
  }
  if (Number(videoDetail?.statusCode) === 10204
      && videoDetail.statusMsg === 'status_deleted') {
    return mk('morto', 'Vídeo removido segundo o estado público do TikTok', 'alta');
  }

  const item = videoDetail?.itemInfo?.itemStruct;
  if (Number(videoDetail?.statusCode) !== 0 || String(item?.id || '') !== videoId) return null;
  const author = String(item.author?.nickname || item.author?.uniqueId || '').trim();
  const description = String(item.desc || '').trim();
  meta.og['og:title'] = (description
    ? `${author ? `${author}: ` : ''}${description}`
    : `Vídeo de ${author ? `@${item.author?.uniqueId || author}` : 'TikTok'}`).slice(0, 500);
  if (description) meta.og['og:description'] = description.slice(0, 500);
  return mk('vivo', 'Vídeo público encontrado no TikTok', 'alta');
}

/**
 * A precedência é intencional: takedown e anti-bot vêm antes de HTTP genérico,
 * seguidos por regras da plataforma, soft-404, página estacionada e sinais de vida.
 */
export function classifyPage({
  url, finalUrl, status, html = '', platform, via = 'fetch', renderedText = '', renderedHeading = '',
  hasPassword = false, customRules = [], contentType = '',
}) {
  const meta = extractMeta(html);
  const textN = norm(renderedText || visibleText(html));
  const titleN = norm(meta.title);
  const ogN = norm(meta.og['og:title'] || '');
  const titles = `${titleN} ${ogN}`;
  const small = textN.length < 6000;
  const head = `${titles} ${textN.slice(0, 6000)}`;
  const finalU = safeUrl(finalUrl || url);
  const origU = safeUrl(url);
  const mk = (st, reason, confidence = 'alta', tags = []) => ({ status: st, reason, confidence, tags, meta, textN });

  const cloudflareErrors = {
    520: 'Erro desconhecido do servidor de origem (Cloudflare 520)',
    521: 'Servidor de origem indisponível (Cloudflare 521)',
    522: 'Timeout no servidor de origem (Cloudflare 522)',
    523: 'Servidor de origem inacessível (Cloudflare 523)',
    524: 'Timeout aguardando resposta do servidor de origem (Cloudflare 524)',
    525: 'Falha no handshake TLS com a origem (Cloudflare 525)',
    526: 'Certificado TLS inválido na origem (Cloudflare 526)',
    530: 'Erro ao conectar ao servidor de origem (Cloudflare 530)',
    1016: 'Erro de DNS na origem (Cloudflare 1016)',
  };

  const securityProvider = /\b(?:kaspersky|eset|bitdefender|avast|norton|mcafee|trend micro|sophos|malwarebytes|windows defender)\b/i
    .exec(head)?.[0];
  const securityBlock = /\b(?:blocked|bloquead[oa]|access denied|acesso negado|threat detected|site unsafe|site perigoso|pagina bloqueada)\b/i
    .test(head);
  if (small && securityProvider && securityBlock) {
    return mk(
      'indeterminado',
      'Bloqueio apresentado por software de segurança; não confirma indisponibilidade do site',
      'baixa',
      ['security-interstitial'],
    );
  }

  if (status === 451) return mk('morto', 'Bloqueado por ordem legal (HTTP 451)', 'alta', ['takedown']);

  const phishingWarning = small
    && /suspected phishing|phishing (?:warning|detected)|deceptive (?:site|website)|dangerous site/i.test(head)
    && /reported (?:for|as) (?:potential )?phishing|warning.{0,80}(?:phishing|deceptive|dangerous)|potential phishing|falsely presenting|ignore and proceed/i.test(head);
  if (phishingWarning) {
    return mk(
      'indeterminado',
      'Aviso de reputação/possível phishing; não confirma remoção ou takedown',
      'alta',
    );
  }

  // 1) Página de derrubada/suspensão — evidência de takedown
  const scope = small ? head : titles;
  for (const r of TAKEDOWN) if (r.re.test(scope)) return mk('morto', r.reason, 'média', ['takedown']);

  // 2) Anti-bot / captcha — não conclusivo
  const chal = CHALLENGE.some((re) => re.test(titleN) || (textN.length < 8000 && re.test(textN)));
  if (platform?.id === 'tiktok' && /\bplease wait\b|checking your browser|verify you are human/i.test(`${titles} ${textN.slice(0, 8000)}`)) {
    return mk('indeterminado', 'TikTok apresentou uma tela de espera ou verificação anti-bot', 'alta', ['anti-bot']);
  }
  if (chal || status === 429 || status === 999) {
    return mk('indeterminado', `Bloqueio anti-bot/captcha${status ? ` (HTTP ${status})` : ''}`, 'alta');
  }

  const cloudflareHeader = `${titles} ${textN.slice(0, 400)}`;
  const cloudflareMarker = /\bcloudflare\b/i.test(cloudflareHeader);
  const cloudflareHttpCode = status >= 520 ? String(status) : '';
  const cloudflareTitle = `${titleN} ${ogN}`;
  const cloudflareBodyCode = Object.keys(cloudflareErrors)
    .find((code) => new RegExp(`\\b${code}\\b`).test(textN.slice(0, 400)));
  const cloudflareCode = cloudflareHttpCode === '530' && cloudflareBodyCode === '1016'
    ? cloudflareBodyCode
    : cloudflareErrors[cloudflareHttpCode]
      ? cloudflareHttpCode
      : Object.keys(cloudflareErrors).find((code) => new RegExp(`\\b${code}\\b`).test(cloudflareTitle))
        || cloudflareBodyCode;
  const cloudflareErrorPhrase = /\bhost error\b|\bweb server is down\b|\borigin is unreachable\b|\borigin dns error\b|\bssl handshake failed\b|\binvalid ssl certificate\b|\bconnection timed out\b|\ba timeout occurred\b|\binitial connection\b/i
    .test(cloudflareHeader);
  const shortCloudflareError = small && textN.length <= 1200
    && cloudflareMarker && cloudflareCode && cloudflareErrorPhrase;
  const cloudflareHttpError = cloudflareErrors[String(status)] && cloudflareMarker;
  const cloudflarePageSignature = /\bray id\b|performance\s*&\s*security by cloudflare/i.test(textN);
  const cloudflareTextError = (status == null && shortCloudflareError)
    || (status === 200 && shortCloudflareError && cloudflarePageSignature);
  if (cloudflareHttpError || cloudflareTextError) {
    return mk('zumbi', cloudflareErrors[cloudflareCode], 'alta', ['cloudflare']);
  }
  if (status === 403 && cloudflareMarker && /\b1020\b/.test(cloudflareHeader)) {
    return mk('indeterminado', 'Bloqueio de acesso da Cloudflare (1020); não indica que o site esteja fora do ar', 'média', ['cloudflare', 'anti-bot']);
  }

  // Facebook can return login pages, generic errors, or stale profile metadata
  // without establishing whether the requested content still exists.
  if (platform && platform.id === 'facebook') {
    const adLibraryId = origU && /^\/ads\/library\/?$/i.test(origU.pathname)
      ? origU.searchParams.get('id')
      : null;
    if (adLibraryId && /^\d+$/.test(adLibraryId)) {
      const idLabel = new RegExp(
        `(?:library id|ad id|id (?:da|de) biblioteca|identificacao da biblioteca)\\s*[:#]?\\s*${adLibraryId}\\b`,
        'i',
      );
      const idMatch = idLabel.exec(textN);
      if (idMatch) {
        const idLabels = [...textN.matchAll(/(?:library id|ad id|id (?:da|de) biblioteca|identificacao da biblioteca)\s*[:#]?\s*\d+/gi)];
        const previousLabel = idLabels.filter((match) => match.index < idMatch.index).at(-1);
        const previousRecordEnd = previousLabel
          ? previousLabel.index + previousLabel[0].length
          : 0;
        const recordStart = Math.max(previousRecordEnd, idMatch.index - 120);
        const recordText = textN
          .slice(recordStart, idMatch.index)
          .replace(/active status:\s*active ads/g, '');
        if (/\binactive\b|\bpaused\b|\bended\b|\binativo\b|\bpausad[oa]\b|\bencerrad[oa]\b/.test(recordText)) {
          return mk('zumbi', 'Anúncio da Meta inativo ou não está sendo veiculado', 'alta');
        }
        if (/\bactive\b|\bativ[oa]\b/.test(recordText)) {
          return mk('vivo', 'Anúncio ativo na Biblioteca de Anúncios da Meta', 'alta');
        }
      }

      if (/ad isn.t in the ad library|ad is no longer available|this ad is not available|anuncio nao (?:esta|se encontra) na biblioteca de anuncios|anuncio nao esta mais disponivel na biblioteca de anuncios|anuncio nao encontrado na biblioteca de anuncios/i.test(textN)) {
        return mk('morto', 'Anúncio não está disponível na Biblioteca de Anúncios da Meta', 'média');
      }
    }

    const profileRoute = (origU && /^\/profile\.php$/i.test(origU.pathname) && origU.searchParams.has('id'))
      || (finalU && /^\/people\/[^/]+\/\d+\/?$/i.test(finalU.pathname));
    const hasFollowerCount = /\b\d[\d,.]*\s+(?:followers|seguidores)\b/.test(textN);
    const hasProfileSections = /\b(?:intro|posts|photos|about|sobre)\b/.test(textN);
    if (via === 'tab' && profileRoute && hasFollowerCount && hasProfileSections && defaultAlive(meta, { platform })) {
      return mk('vivo', 'Perfil público encontrado', 'alta');
    }

    const removed = /(?:this|the) (?:content|page|profile|account|post|video) (?:has been |was )?(?:removed|deleted|disabled|deactivated|suspended)|(?:content|page|profile|account) (?:was|has been) (?:removed|deleted|disabled|deactivated|suspended)|we couldn.t find (?:this|that|the) (?:profile|page|account)|(?:profile|page|account) (?:not found|doesn.t exist|does not exist)|essa (?:pagina|conta) (?:foi )?(?:removida|excluida|desativada|desativado)|(?:conteudo|perfil|pagina|conta) (?:foi )?(?:removido|removida|excluido|excluida|desativado|desativada)|nao foi possivel encontrar (?:este|esse|o) (?:perfil|pagina|conta)|(?:perfil|pagina|conta) nao (?:existe|encontrad[oa]|foi encontrad[oa])/i;
    if (removed.test(textN)) return mk('morto', 'Perfil/conteúdo removido ou inexistente no Facebook', 'média');

    // The user treats Facebook's generic unavailable interstitial as a dead
    // link, even though Facebook does not distinguish deletion from privacy.
    const unavailable = /(?:(?:this|the) )?(?:content|page|profile|post|video) (?:isn.t|is not) available(?: right now)?|(?:(?:o|a|este|esse|esta) )?(?:conteudo|pagina|perfil|publicacao|video) (?:nao (?:esta )?disponivel|indisponivel)(?: no momento| agora)?|sorry, this page isn.t available|o conteudo que voce solicitou nao esta disponivel|somente pessoas.{0,80}(?:podem|can) ver/i;
    if (unavailable.test(textN)) return mk('morto', 'Conteúdo não acessível publicamente no Facebook', 'média');
    const marketplaceUnavailable = /(?:this|the) listing (?:is no longer available|isn.t available anymore|is not available)|(?:este|esse|o) anuncio (?:nao esta mais disponivel|nao esta disponivel|foi removido|foi excluido)/i;
    if (marketplaceUnavailable.test(textN)) return mk('morto', 'Anúncio do Marketplace não está mais disponível', 'média');

    const marketplaceRoute = [origU, finalU].some((u) => u && /^\/marketplace\/item\/\d+\/?$/i.test(u.pathname));
    const marketplaceTitle = /\bfacebook marketplace\b|\bmarketplace\s+[—–-]\s+.+\|\s*facebook\b/i.test(titles)
      && defaultAlive(meta, { platform });
    const hasListingContext = /\b(?:listed|posted)\s+\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b|\b(?:anunciad[oa]|publicad[oa])\s+(?:ha\s+)?\d+\s+(?:minutos?|horas?|dias?|semanas?|meses?|anos?)\b|\b(?:listed|posted|anunciad[oa]|publicad[oa])\s+(?:today|yesterday|hoje|ontem)\b|\b(?:listed in|in stock|public meetup|door dropoff)\b/.test(textN);
    const hasListingPrice = /(?:\br\$\s?\d|\b(?:us\$|c\$|a\$)\s?\d|[$€£]\s?\d|\b\d[\d.,]*\s?(?:brl|usd|eur)\b|\b(?:free|gratis|gratuito)\b)/.test(textN);
    const hasSellerDetails = /\b(?:seller information|seller details|condition|informacoes do vendedor|detalhes do vendedor|informacoes do anunciante|condicao)\b/.test(textN);
    if (via === 'tab' && marketplaceRoute && marketplaceTitle && hasListingContext && hasListingPrice && hasSellerDetails) {
      return mk('vivo', 'Anúncio público do Facebook Marketplace encontrado', 'alta');
    }

    const loginRoute = finalU && /^\/(login(?:\.php)?|checkpoint|recover|consent)(\/|$)/i.test(finalU.pathname);
    const loginText = /log ?in (to|or sign up)|sign in to facebook|log ?in to (continue|see|view)|you must log in|entrar no facebook|entrar (ou )?(cadastrar|continuar|ver)|faca login|entre para continuar|connect with friends and the world around you|join facebook to connect|inicie sessao para|iniciar sessao|crie uma conta para/i.test(textN.slice(0, 8000));
    if (loginRoute || hasPassword || loginText) return mk('indeterminado', 'Facebook exige login ou apresentou uma tela de autenticação', 'média');
  }

  // 3) Códigos HTTP
  if (status === 404 || status === 410) {
    if (platform && platform.id === 'facebook') {
      return mk('indeterminado', `Facebook respondeu HTTP ${status}; isso não confirma que o perfil/conteúdo foi removido`, 'baixa');
    }
    return mk('morto', status === 410 ? 'Removido permanentemente (HTTP 410)' : 'Não encontrado (HTTP 404)', 'alta');
  }
  if (status === 401) return mk('indeterminado', 'Exige autenticação (HTTP 401)', 'média');
  if (status === 403) {
    return platform
      ? mk('indeterminado', 'Acesso negado/anti-bot da plataforma (HTTP 403)', 'média')
      : mk('zumbi', 'Acesso negado (HTTP 403)', 'média');
  }
  if (status >= 500) return mk('zumbi', `Erro de servidor (HTTP ${status})`, 'alta');
  if (status >= 400) return mk('zumbi', `Erro HTTP ${status}`, 'média');
  if (status === 200 && contentType && !/^(?:text\/|application\/(?:xhtml\+xml|json|[^;]+\+xml|javascript|ecmascript))/i.test(contentType)) {
    const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
    return mk('vivo', `Arquivo para download disponível (${mediaType})`, 'média', ['download']);
  }

  // 4) Regras específicas da plataforma (anúncio removido, conta suspensa…)
  if (platform) {
    if (platform.deadFn) {
      const d = platform.deadFn(meta, { html, textN, url: finalU });
      if (d) return mk(d.status, d.reason, d.confidence);
    }
    for (const r of platform.dead || []) {
      if (r.re.test(head)) return mk(r.status, r.reason, r.re.test(titles) ? 'alta' : 'média');
    }
    if (platform.item && origU && finalU && platform.item(origU) && !platform.item(finalU)
        && platform.hosts.some((h) => h.test(finalU.hostname))) {
      return mk('morto', 'Redirecionado para busca/home — provável anúncio removido', 'média');
    }
  }

  // 5) Soft 404
  if (SOFT404_TITLE.test(titleN)) return mk('morto', 'Soft 404: a página diz "não encontrada" (HTTP 200)', 'alta');
  if (textN.length < 3000 && SOFT404_BODY.test(textN) && !platform) return mk('morto', 'Soft 404 (texto da página)', 'média');

  // 6) Estacionado / página padrão / manutenção
  if (status === 200 && /window\.LANDER_SYSTEM\s*=\s*["']PW["']|parking-lander\/static\/js/i.test(html)) {
    return mk('morto', 'Página de domínio estacionado pela GoDaddy sem conteúdo ativo', 'alta', ['parked']);
  }
  const explanatoryParkingText = /(?:what does|meaning of|guide to|how to|explains?).{0,100}(?:domain(?: name)? (?:is|may be) for sale|buy a domain|make an offer)|(?:o que significa|guia|como comprar|explica).{0,100}(?:dominio (?:esta )?a venda|comprar dominio|fazer uma oferta)/i
    .test(head)
    || /(?:what does|meaning of|guide to|how to|explains?|article about|tutorial about).{0,100}domain (?:is )?parked|(?:o que significa|guia|como|explica|artigo sobre|tutorial sobre).{0,100}dominio estacionado/i
      .test(head);
  if (small && textN.length <= 3000 && DOMAIN_SALE.test(head)
      && !explanatoryParkingText
      && (DOMAIN_SALE_CTA.test(head) || DOMAIN_PARKING_PROVIDERS.test(`${head} ${html}`))) {
    const providerText = `${head} ${html}`;
    const providerReason = /\bgodaddy\b/i.test(providerText)
      ? 'Domínio estacionado pela GoDaddy sem conteúdo ativo'
      : DOMAIN_PARKING_PROVIDERS.test(providerText)
        ? 'Domínio estacionado por provedor de parking, sem conteúdo ativo'
        : 'Domínio anunciado para venda, sem conteúdo ativo';
    const confidence = /\bgodaddy\b/i.test(providerText) || DOMAIN_PARKING_PROVIDERS.test(providerText)
      ? 'alta'
      : 'média';
    return mk('morto', providerReason, confidence, ['parked']);
  }
  for (const r of PARKED) {
    if (r.onlyIfSmall && textN.length > 1500) continue;
    if (explanatoryParkingText && /dominio (?:a venda|estacionado)/i.test(norm(r.reason))) continue;
    if (r.re.test(head)) {
      const domainParking = /dominio (?:a venda|estacionado)/i.test(norm(r.reason));
      return mk(
        r.status || 'zumbi',
        r.reason,
        'média',
        domainParking ? ['parked'] : [],
      );
    }
  }
  if (!platform && html.length < 400 && textN.length < 40 && !meta.title && !meta.refresh) {
    return mk('zumbi', 'Resposta vazia (sem conteúdo)', 'média');
  }

  const normalizedRules = customRules.map((rule) => ({
    ...rule,
    normalizedTerm: rule.normalizedTerm || norm(normalizeCustomRuleTerm(rule.term)),
  }));
  const customRuleText = `${titles} ${textN.slice(0, 50000)}`;
  const customRule = normalizedRules.find(({ normalizedTerm }) => {
    if (!normalizedTerm) return false;
    let start = customRuleText.indexOf(normalizedTerm);
    while (start !== -1) {
      const end = start + normalizedTerm.length;
      const word = /[\p{L}\p{N}_]/u;
      const startsWithWord = word.test(normalizedTerm[0]);
      const endsWithWord = word.test(normalizedTerm.at(-1));
      const leftBoundary = !startsWithWord || start === 0 || !word.test(customRuleText[start - 1]);
      const rightBoundary = !endsWithWord || end === customRuleText.length || !word.test(customRuleText[end]);
      if (leftBoundary && rightBoundary) return true;
      start = customRuleText.indexOf(normalizedTerm, start + 1);
    }
    return false;
  });
  if (customRule) {
    const loginWall = hasPassword || LOGIN_WALL.test(textN.slice(0, 3000));
    if (platform && loginWall) {
      return mk('indeterminado', 'A página apresentou uma barreira de login; a regra personalizada não foi aplicada', 'média', ['login']);
    }
    const labels = { vivo: 'VIVO', zumbi: 'ZUMBI', morto: 'MORTO' };
    return mk(
      customRule.status,
      `Regra personalizada: “${customRule.term}” → ${labels[customRule.status]}`,
      'média',
      ['custom'],
    );
  }

  // 7) Plataformas
  if (platform) {
    if (platform.static) return { ...mk(platform.static.status, platform.static.reason, platform.static.confidence) };
    if (platform.id === 'tiktok') {
      const videoResult = classifyTikTokVideo(url, html, meta, mk);
      if (videoResult) return videoResult;
    }
    if (platform.needsBrowser && via === 'fetch') {
      return mk('indeterminado', 'Plataforma renderiza via JavaScript — use o modo aba para confirmar', 'alta');
    }
    const profileRoute = origU && /^\/@[^/]+\/?$/.test(origU.pathname);
    const headingN = norm(renderedHeading);
    const genericHeading = /^(?:tiktok|for you|following|friends|inbox|profile|discover|live|search|log ?in|sign ?in|sign ?up|entrar|cadastre-se|join tiktok|please wait)$/i.test(headingN)
      || CHALLENGE.some((pattern) => pattern.test(headingN));
    const authenticationWall = hasPassword
      || LOGIN_WALL.test(textN.slice(0, 3000))
      || LOGIN_WALL.test(headingN);
    if (platform.id === 'tiktok' && via === 'tab' && profileRoute && headingN
        && !genericHeading && !authenticationWall) {
      return mk('vivo', 'Perfil público encontrado', 'média');
    }
    const alive = (platform.alive || defaultAlive)(meta, { html, textN, platform, url: finalU });
    if (!alive) {
      const wall = LOGIN_WALL.test(textN.slice(0, 3000)) || /log ?in|entrar|sign (in|up)|cadastr/.test(titles);
      return mk('indeterminado', wall ? 'Exige login para ver o conteúdo' : 'Sem sinal conclusivo de conteúdo público', 'média');
    }
    const structured = !!meta.product || !!meta.og['og:title'];
    return mk('vivo', 'Conteúdo público encontrado', structured ? 'alta' : 'média');
  }

  const crossHost = finalU && origU && registrableDomain(finalU.hostname) !== registrableDomain(origU.hostname);
  return crossHost
    ? mk('vivo', `Respondeu após redirecionar para outro domínio (${finalU.hostname}); confirme o destino`, 'média', ['redirect-externo'])
    : mk('vivo', 'Respondeu normalmente', 'alta');
}
