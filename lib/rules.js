// Regras de detecção. Tudo aqui é DADOS que você pode ajustar conforme as plataformas mudam.
// Os padrões rodam sobre texto normalizado (minúsculo, sem acentos) — escreva-os assim.
// A ordem dentro das listas pode afetar qual motivo aparece primeiro; valide mudanças com exemplos vivos e removidos.

import { norm } from './text.js';

/* ---------- Padrões genéricos ---------- */

// Página de derrubada / suspensão (evidência de takedown). Status: morto.
export const TAKEDOWN = [
  { re: /suspected phishing|phishing (warning|detected|site)|deceptive (site|website)|dangerous site/, reason: 'Interstício de phishing/site enganoso' },
  { re: /(this|the) (web)?site (has been|is|was) (suspended|disabled|taken down|blocked|removed|deactivated)/, reason: 'Site suspenso/derrubado pelo provedor' },
  { re: /(account|conta|site|website|dominio|domain) (has been |foi |esta |is )?(suspens[oa]|suspended)/, reason: 'Conta/site/domínio suspenso' },
  { re: /(este|esse) (site|dominio|website|endereco) (foi|esta) (suspens|desativad|bloquead|removid|derrubad)\w*/, reason: 'Site/domínio suspenso ou bloqueado' },
  { re: /domain (has been )?(seized|blocked|suspended)|dominio (foi )?(apreendido|bloqueado|suspenso)|clienthold|serverhold/, reason: 'Domínio apreendido/bloqueado' },
  { re: /bloquead[oa] (por|a pedido|conforme|em cumprimento|por determinacao)|em cumprimento (a|de) (ordem|decisao|determinacao) judicial/, reason: 'Bloqueado por ordem/decisão' },
  { re: /(has|have) been reported (for|as) (abuse|phishing|fraud)|abuse (report|complaint)|violat\w+ (our |the )?(terms|acceptable use|policy).{0,60}(suspend|remov|disabl)/, reason: 'Removido por denúncia de abuso' },
  { re: /sinkhole(d)?|this domain has been (taken over|redirected) (by|to)/, reason: 'Domínio em sinkhole' },
  { re: /(este )?(conteudo|site|pagina) (foi|esta) (removid|indisponivel).{0,40}(denuncia|violacao|abuso|decisao)/, reason: 'Conteúdo removido por denúncia/violação' },
];

// Página estacionada / padrão do servidor / manutenção. Status: zumbi.
export const PARKED = [
  { re: /(this )?domain( name)? (is|may be) for sale|buy this domain|dominio (esta )?a venda|comprar este dominio|make an offer (on|for) this domain/, reason: 'Domínio à venda/estacionado' },
  { re: /sedoparking|hugedomains|afternic|parkingcrew|bodis\.com|domain (is )?parked|parked (free|domain)|this domain is registered/, reason: 'Domínio estacionado' },
  { re: /welcome to nginx|apache2? (ubuntu |debian )?default page|test page for the apache|iis windows server|it works!|default web site page|index of \//, reason: 'Página padrão do servidor (sem conteúdo)' },
  { re: /(bandwidth|resource) limit (is )?(exceeded|reached)|limite de (banda|recursos) (excedido|atingido)/, reason: 'Cota do hosting excedida' },
  { re: /site (em construcao|em manutencao|indisponivel)|under construction|coming soon|em breve|down for maintenance|site is currently unavailable/, reason: 'Em construção/manutenção/indisponível', onlyIfSmall: true },
];

// Soft 404: HTTP 200 mas o conteúdo diz que não existe.
export const SOFT404_TITLE = /^(error )?40[34]\b|\bnot found\b|nao (foi )?encontrad[oa]|(page|pagina) (does not|doesn't|nao) exist|erro 40[34]|error 40[34]|conteudo indisponivel|nada encontrado/;
export const SOFT404_BODY = /\b40[34]\b|not found|nao (foi )?encontrad[oa]|nao existe|does not exist|doesn't exist|link (quebrado|expirado)|(esta )?pagina nao esta disponivel/;

// Anti-bot / captcha: NÃO é prova de morte nem de vida.
export const CHALLENGE = [
  /just a moment/, /checking your browser/, /attention required/, /verify you are (a )?human/,
  /verifique que voce e humano|confirme que voce nao e um robo/, /px-captcha|_incapsula_|incapsula incident/,
  /access denied.{0,80}(reference|errors\.edgesuite)|request blocked/, /enable javascript and cookies to continue/,
  /unusual traffic|trafego incomum/, /are you a robot|voce e um robo/,
];

export const LOGIN_WALL = /(faca login|entre|log in|sign in|login) (para|to) (continuar|ver|see|continue|view)|log in or sign up|entrar ou cadastrar|you must (log|sign) in|login required|inicie sessao/;

/* ---------- Plataformas: anúncios (marketplaces) ---------- */

const MARKET_DEAD = [
  { re: /(anuncio|publicacao|produto|item|oferta)s? (ja )?(foi|esta|estao) (removid|finalizad|encerrad|expirad|desativad|excluid)\w*/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /(anuncio|publicacao|oferta) (removid|finalizad|encerrad|expirad|desativad|excluid)\w*/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /nao esta mais (disponivel|a venda|ativ[oa])|nao existe mais|(anuncio|publicacao|produto|pagina) nao (existe|foi encontrad[oa])/, status: 'morto', reason: 'Anúncio inexistente/indisponível' },
  { re: /(anuncio|publicacao) (foi |esta )?pausad\w*/, status: 'zumbi', reason: 'Anúncio pausado' },
  { re: /(loja|vendedor|perfil|usuario) (nao existe|foi (removid|suspens|bloquead|desativad)\w*|(suspens|bloquead|desativad)\w*)/, status: 'morto', reason: 'Loja/vendedor removido ou suspenso' },
  { re: /(listing|item|ad) (is )?(no longer available|isn't available anymore|has been (removed|deleted))/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /(produto|item) (temporariamente )?indisponivel/, status: 'zumbi', reason: 'Produto indisponível' },
];

/* ---------- Plataformas: redes sociais / mensageria ---------- */

const SOCIAL_DEAD = [
  // Facebook usa regras próprias em analyzer.js porque indisponibilidade pode ser privacidade/login.
  { re: /(esta |this )?(pagina|page) (nao (esta )?disponivel|indisponivel|isn't available|not found|nao encontrada|nao foi encontrada)|sorry, this page isn't available/, status: 'morto', reason: 'Página/perfil indisponível' },
  { re: /(este |this )?conteudo (nao (esta )?disponivel|indisponivel|isn't available)|this content isn't available/, status: 'morto', reason: 'Conteúdo indisponível' },
  { re: /(conta|account) (suspensa|suspended)|essa conta (nao existe|foi suspensa)|this account (doesn't exist|has been suspended)/, status: 'morto', reason: 'Conta suspensa/inexistente' },
  { re: /couldn't find this account|nao foi possivel encontrar esta conta|hmm\.{0,3} ?this page doesn't exist|essa pagina nao existe/, status: 'morto', reason: 'Conta/página inexistente' },
  { re: /(video|post|publicacao|reel) (indisponivel|nao esta disponivel|removido)|video currently unavailable|this video isn't available|this post isn't available/, status: 'morto', reason: 'Vídeo/post indisponível' },
  { re: /(o )?link (que voce seguiu|you followed) (pode estar|may be) (quebrado|broken)/, status: 'morto', reason: 'Link quebrado / conteúdo removido' },
  { re: /invite link (is )?(invalid|revoked|expired|reset)|link de convite (e |foi |esta )?(invalido|revogado|expirou|redefinido)|convite.{0,30}(invalido|expirado)/, status: 'morto', reason: 'Convite inválido/revogado/expirado' },
  { re: /(this )?(channel|canal) (has been terminated|foi encerrado|nao esta disponivel|isn't available)|conta do youtube.{0,30}(encerrada|terminated)/, status: 'morto', reason: 'Canal encerrado/indisponível' },
];

/* ---------- Sondas por API pública (respostas definitivas) ---------- */

async function ytProbe(u, { getJson }) {
  if (!/youtu\.be\/|\/watch|\/shorts\/|\/live\/|\/embed\//.test(u.href)) return null;
  const r = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Vídeo disponível (oEmbed)', confidence: 'alta', title: r.json.title, author: r.json.author_name };
  if (r.status === 404 || r.status === 400) return { status: 'morto', reason: 'Vídeo removido/inexistente (oEmbed 404)', confidence: 'alta' };
  if (r.status === 401 || r.status === 403) return { status: 'indeterminado', reason: 'Vídeo privado ou com embed desativado', confidence: 'média' };
  return null;
}

async function xProbe(u, { getJson }) {
  if (!/\/status(es)?\/\d+/.test(u.pathname)) return null;
  const r = await getJson(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(u.href)}`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Post disponível (oEmbed)', confidence: 'alta', title: r.json.author_name ? `Post de ${r.json.author_name}` : '', author: r.json.author_name };
  if (r.status === 404) return { status: 'morto', reason: 'Post removido ou conta suspensa (oEmbed 404)', confidence: 'alta' };
  return null;
}

async function tiktokProbe(u, { getJson }) {
  if (!/\/(video|photo)\/\d+|^(vm|vt)\.tiktok\.com$/.test(u.pathname) && !/^(vm|vt)\./.test(u.hostname)) return null;
  const r = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.href)}`);
  if (r.status === 200 && r.json && r.json.title !== undefined && !r.json.code) return { status: 'vivo', reason: 'Vídeo disponível (oEmbed)', confidence: 'alta', title: r.json.title, author: r.json.author_name };
  if (r.status === 400 || r.status === 404) return { status: 'morto', reason: 'Vídeo indisponível (oEmbed)', confidence: 'média' };
  return null;
}

async function discordProbe(u, { getJson }) {
  const code = u.pathname.split('/').filter(Boolean).pop();
  if (!code) return null;
  const r = await getJson(`https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Convite válido', confidence: 'alta', title: r.json.guild?.name || r.json.channel?.name || '' };
  if (r.status === 404) return { status: 'morto', reason: 'Convite inexistente/expirado', confidence: 'alta' };
  return null;
}

async function shopeeProbe(u, { getJson }) {
  const m = u.pathname.match(/\/product\/(\d+)\/(\d+)/) || u.pathname.match(/-i\.(\d+)\.(\d+)/);
  if (!m) return null;
  // Melhor esforço: a Shopee costuma bloquear essa chamada sem tokens anti-bot.
  const r = await getJson(`https://${u.hostname}/api/v4/item/get?itemid=${m[2]}&shopid=${m[1]}`);
  const d = r.json && r.json.data;
  if (r.status === 200 && d && (d.itemid || d.item_id) && d.name) {
    return { status: 'vivo', reason: 'Produto encontrado (API Shopee)', confidence: 'alta', title: d.name, price: d.price ? d.price / 100000 : '' };
  }
  return null;
}

/* ---------- Catálogo ---------- */

const gen = (id, name, kind, hosts, extra = {}) => ({ id, name, kind, hosts, ...extra });

function facebookAlive(meta, { textN, platform }) {
  return defaultAlive(meta, { platform }) && textN.length >= 80;
}

export const PLATFORMS = [
  // Marketplaces
  gen('mercadolivre', 'Mercado Livre', 'marketplace', [/(^|\.)mercadoli(vre|bre)\.com(\.[a-z]{2})?$/, /^meli\.la$/], {
    dead: MARKET_DEAD,
    item: (u) => /\bMLB-?\d{6,}/i.test(u.pathname) || /\/p\/MLB\d+/.test(u.pathname),
  }),
  gen('olx', 'OLX', 'marketplace', [/(^|\.)olx\.com\.br$/], {
    dead: MARKET_DEAD,
    item: (u) => /-\d{7,}\/?$/.test(u.pathname),
  }),
  gen('shopee', 'Shopee', 'marketplace', [/(^|\.)shopee\.com(\.br)?$/, /^shp\.ee$/], {
    dead: [...MARKET_DEAD, { re: /(este )?produto (nao existe|nao esta disponivel|indisponivel)|this product (doesn't exist|is unavailable)/, status: 'morto', reason: 'Produto inexistente/indisponível' }],
    item: (u) => /\/product\/\d+\/\d+/.test(u.pathname) || /-i\.\d+\.\d+/.test(u.pathname),
    needsBrowser: true, requireAlive: true, probe: shopeeProbe,
  }),
  gen('amazon', 'Amazon', 'marketplace', [/(^|\.)amazon\.com\.br$/], {
    dead: [...MARKET_DEAD, { re: /nao conseguimos encontrar essa pagina|looking for something\? we're sorry/, status: 'morto', reason: 'Página inexistente' }],
    item: (u) => /\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(u.pathname),
  }),
  gen('magalu', 'Magazine Luiza', 'marketplace', [/(^|\.)magazineluiza\.com\.br$/, /(^|\.)magalu\.com$/], { dead: MARKET_DEAD, item: (u) => /\/p\/[a-z0-9]+\/?/i.test(u.pathname) }),
  gen('enjoei', 'Enjoei', 'marketplace', [/(^|\.)enjoei\.com\.br$/], { dead: MARKET_DEAD, item: (u) => /\/p\//.test(u.pathname) }),
  gen('americanas', 'Americanas', 'marketplace', [/(^|\.)americanas\.com\.br$/], { dead: MARKET_DEAD, item: (u) => /\/produto\//.test(u.pathname) }),

  // Redes sociais
  gen('instagram', 'Instagram', 'social', [/(^|\.)instagram\.com$/, /^instagr\.am$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true }),
  gen('facebook', 'Facebook', 'social', [/(^|\.)facebook\.com$/, /^fb\.(com|me|watch)$/, /(^|\.)fb\.com$/], {
    dead: [
      { re: /(?:this|the) (?:page|profile|account|post|video) (?:has been |was )?(?:removed|deleted|disabled|deactivated|suspended)|(?:page|profile|account) (?:not found|doesn.t exist|does not exist)|(?:pagina|perfil|conta) (?:foi )?(?:removida|excluida|desativada|suspensa)|(?:pagina|perfil|conta) nao (?:existe|encontrad[oa])/, status: 'morto', reason: 'Página/perfil removido ou inexistente' },
      { re: /(este|this) (anuncio|listing) (nao esta mais disponivel|isn't available anymore|is no longer available)/, status: 'morto', reason: 'Anúncio do Marketplace removido' },
    ],
    needsBrowser: true, requireAlive: true, alive: facebookAlive,
  }),
  gen('x', 'X (Twitter)', 'social', [/(^|\.)(x|twitter)\.com$/, /^t\.co$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true, probe: xProbe }),
  gen('tiktok', 'TikTok', 'social', [/(^|\.)tiktok\.com$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true, probe: tiktokProbe }),
  gen('youtube', 'YouTube', 'social', [/(^|\.)youtube\.com$/, /^youtu\.be$/], { dead: SOCIAL_DEAD, requireAlive: true, probe: ytProbe }),
  gen('threads', 'Threads', 'social', [/(^|\.)threads\.(net|com)$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true }),
  gen('linkedin', 'LinkedIn', 'social', [/(^|\.)linkedin\.com$/], {
    dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true,
    tabSafe: false, // abrir perfis com a sua conta logada notifica "quem viu seu perfil"
  }),
  gen('kwai', 'Kwai', 'social', [/(^|\.)kwai(-video)?\.com$/], { dead: SOCIAL_DEAD, requireAlive: true }),
  gen('reddit', 'Reddit', 'social', [/(^|\.)reddit\.com$/], { dead: SOCIAL_DEAD, requireAlive: true }),
  gen('pinterest', 'Pinterest', 'social', [/(^|\.)pinterest\.(com|com\.br)$/], { dead: SOCIAL_DEAD, requireAlive: true }),

  // Mensageria
  gen('telegram', 'Telegram', 'messaging', [/^(t|telegram)\.me$/], {
    dead: SOCIAL_DEAD, requireAlive: true,
    // t.me/<usuario>: página real traz .tgme_page_extra (ex.: "@user" ou "N membros").
    alive: (meta, { html }) => /tgme_page_extra|tgme_page_photo/.test(html),
    deadFn: (meta, { html }) => (/^telegram: contact @/i.test(meta.og['og:title'] || meta.title || '') && !/tgme_page_extra/.test(html))
      ? { status: 'morto', reason: 'Username sem página pública (inexistente/banido?)', confidence: 'média' } : null,
  }),
  gen('whatsapp-invite', 'WhatsApp (grupo)', 'messaging', [/^chat\.whatsapp\.com$/], {
    dead: SOCIAL_DEAD, requireAlive: true,
    alive: (meta) => !!meta.og['og:title'] && !/^whatsapp (group )?invite$|^convite/i.test(norm(meta.og['og:title'])),
  }),
  gen('whatsapp-link', 'WhatsApp (wa.me)', 'messaging', [/^wa\.me$/, /^api\.whatsapp\.com$/], {
    // Link de clique-para-conversar: a página abre mesmo se o número não existir.
    static: { status: 'indeterminado', reason: 'Link wa.me/click-to-chat não revela se o número existe', confidence: 'alta' },
  }),
  gen('discord', 'Discord', 'messaging', [/^discord\.gg$/, /(^|\.)discord\.com$/], { dead: SOCIAL_DEAD, requireAlive: true, probe: discordProbe }),
];

/**
 * Identifica plataforma pelo hostname; URLs do Marketplace do Facebook recebem tipo próprio.
 * Retorna null quando não há regra correspondente.
 */
export function detectPlatform(u) {
  const host = u.hostname.toLowerCase();
  const isFbMarket = /facebook\.com$/.test(host) && /\/marketplace\/item\//.test(u.pathname);
  const p = PLATFORMS.find((pl) => pl.hosts.some((h) => h.test(host)));
  if (p && isFbMarket) return { ...p, kind: 'marketplace' };
  return p || null;
}

/** Título "genérico" (shell/login) não prova que o conteúdo existe. */
export function defaultAlive(meta, { platform }) {
  const t = norm(meta.og['og:title'] || meta.title || '');
  if (!t) return false;
  const names = [platform.name, platform.id, 'x', 'tiktok', 'twitter'].map(norm);
  if (names.includes(t)) return false;
  if (/(log ?in|entrar|sign (in|up)|cadastr|inscreva)/.test(t)) return false;
  if (/make your day|just a moment/.test(t)) return false;
  return true;
}
