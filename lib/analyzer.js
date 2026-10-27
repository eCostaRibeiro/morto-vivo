// Núcleo: busca a URL e classifica em VIVO / ZUMBI / MORTO / INDETERMINADO com motivo e confiança.
//
//  vivo          responde e o conteúdo é o esperado
//  zumbi         responde, mas não é o conteúdo (erro 5xx/403, página estacionada/padrão, anúncio pausado…)
//  morto         não existe mais (NXDOMAIN, 404/410, soft-404, anúncio/perfil removido, takedown)
//  indeterminado não dá para afirmar (anti-bot/captcha, login obrigatório, SPA que exige JS)
//
// Regra de ouro: na dúvida, "indeterminado" — nunca chutar morto/vivo em plataformas que escondem conteúdo.
// checkUrl coordena sondas, fetch/aba e classificação; classifyPage mantém a precedência das evidências.

import { classifyPage } from './classification.js';
import {
  extractMeta, visibleText, sha256Hex,
} from './text.js';
import { detectPlatform } from './rules.js';
import { NetworkSafetyError, fetchPublicResource } from './networkSafety.js';

export { classifyPage };

/* ---------- rede ---------- */

function facebookProfileSlugTitle(value) {
  let pathname;
  try { pathname = new URL(value).pathname; } catch { return ''; }
  const slug = pathname.split('/').filter(Boolean)[0] || '';
  if (!slug || /^(?:profile\.php|groups?|pages?|marketplace|ads|watch|reel|login|events?)$/i.test(slug)
      || !/[a-z]/i.test(slug)) return '';
  let decoded;
  try { decoded = decodeURIComponent(slug); } catch { decoded = slug; }
  return decoded
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => /^[A-Z\d]+$/.test(word) ? word : word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 300);
}

/** Propaga um cancelamento externo (botão "Cancelar análise") para o AbortController interno. */
function linkAbort(ctl, externalSignal) {
  if (!externalSignal) return () => {};
  if (externalSignal.aborted) { ctl.abort(); return () => {}; }
  const onAbort = () => ctl.abort();
  externalSignal.addEventListener('abort', onAbort);
  return () => externalSignal.removeEventListener('abort', onAbort);
}

async function readLimited(resp, maxBytes) {
  const ct = resp.headers.get('content-type') || '';
  const charset = (ct.match(/charset=([\w-]+)/i) || [])[1];
  let dec;
  try { dec = new TextDecoder(charset || 'utf-8'); } catch { dec = new TextDecoder('utf-8'); }
  if (!resp.body || !resp.body.getReader) return dec.decode(await resp.arrayBuffer()).slice(0, maxBytes);
  const reader = resp.body.getReader();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    out += dec.decode(value, { stream: true });
    if (total >= maxBytes) { try { await reader.cancel(); } catch { /* ok */ } break; }
  }
  return out;
}

/**
 * Busca uma página sem cookies e lê o corpo incrementalmente até o limite configurado,
 * quando a resposta oferece um stream.
 * `ctx` pode injetar `fetchFn`, `opts`, `doh` e `signal` para teste e cancelamento.
 */
export async function fetchPage(url, ctx) {
  const { fetchFn = fetch, opts = {} } = ctx;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 15000);
  const unlink = linkAbort(ctl, ctx.signal);
  try {
    const requestOptions = {
      method: 'GET',
      credentials: 'omit', // não envia cookies do analista para páginas suspeitas
      cache: 'no-store',
      signal: ctl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6' },
    };
    let { response, finalUrl, redirected } = await fetchPublicResource(url, requestOptions, {
      fetchFn,
      resolveHost: ctx.doh,
    });
    let ct = response.headers.get('content-type') || '';
    let text = !ct || /html|json|text|xml/i.test(ct)
      ? await readLimited(response, opts.maxBytes || 600000)
      : '';
    const scriptRedirect = text.length <= 2000 && !visibleText(text)
      ? text.match(/(?:window\.)?location(?:\.href)?\s*=\s*(['"])(\/[^'"\\\s]*)\1/i)?.[2]
      : null;
    if (response.status === 200 && scriptRedirect) {
      const target = new URL(scriptRedirect, finalUrl);
      if (target.origin === new URL(finalUrl).origin) {
        ({ response, finalUrl } = await fetchPublicResource(target.href, requestOptions, {
          fetchFn,
          resolveHost: ctx.doh,
        }));
        redirected = true;
        ct = response.headers.get('content-type') || '';
        text = !ct || /html|json|text|xml/i.test(ct)
          ? await readLimited(response, opts.maxBytes || 600000)
          : '';
      }
    }
    return { status: response.status, finalUrl, redirected, text, ct };
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

async function getJson(url, ctx) {
  const { fetchFn = fetch } = ctx;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  const unlink = linkAbort(ctl, ctx.signal);
  try {
    const { response: r } = await fetchPublicResource(url, {
      credentials: 'omit', cache: 'no-store', signal: ctl.signal, headers: { Accept: 'application/json' },
    }, { fetchFn, resolveHost: ctx.doh });
    const t = await r.text();
    let json = null;
    try { json = JSON.parse(t); } catch { /* não é JSON */ }
    return { status: r.status, json, text: t };
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

/* ---------- fluxo completo para uma URL ---------- */

async function classifyNetworkError(res, u, err, platform, ctx) {
  if (err instanceof NetworkSafetyError) {
    if (err.kind === 'nxdomain') return { status: 'morto', reason: err.message, confidence: 'alta', tags: ['dns'] };
    return { status: 'indeterminado', reason: err.message, confidence: 'alta', tags: ['seguranca'] };
  }
  const timeout = err && err.name === 'AbortError';
  let dns = null;
  if (ctx.doh) {
    try { dns = await ctx.doh(u.hostname); } catch { dns = null; }
  }
  if (dns) res.info.dns = { rcode: dns.rcode, addresses: dns.addresses };
  if (dns && dns.nxdomain) return { status: 'morto', reason: 'Domínio não existe (NXDOMAIN)', confidence: 'alta', tags: ['dns'] };
  if (dns && dns.servfail) return { status: 'indeterminado', reason: 'Falha temporária na resolução DNS (SERVFAIL)', confidence: 'baixa', tags: ['dns'] };
  if (dns && dns.rcode === 0 && !dns.hasAddress) return { status: 'indeterminado', reason: 'Domínio sem registro A/AAAA; não foi possível confirmar se o site está ativo', confidence: 'baixa', tags: ['dns'] };
  if (dns && dns.sinkhole) return { status: 'indeterminado', reason: 'DNS aponta para IP nulo/privado (possível sinkhole/bloqueio)', confidence: 'baixa', tags: ['dns'] };
  if (timeout) return { status: 'indeterminado', reason: 'Sem resposta (timeout)', confidence: 'baixa', tags: [] };
  if (platform) return { status: 'indeterminado', reason: 'Falha de rede ao acessar a plataforma', confidence: 'baixa', tags: [] };
  if (dns && dns.hasAddress && err instanceof TypeError) {
    return {
      status: 'indeterminado',
      reason: 'DNS resolve para endereço público, mas a conexão/TLS falhou; pode ser bloqueio ou problema de rede local',
      confidence: 'baixa',
      tags: ['rede'],
    };
  }
  return { status: 'indeterminado', reason: dns ? 'DNS resolve, mas a conexão/TLS falhou' : 'Falha de conexão/DNS', confidence: 'baixa', tags: [] };
}

export function markHttpFallback(cls) {
  return {
    ...cls,
    reason: `${cls.reason} (resultado obtido via HTTP após falha HTTPS)`,
    confidence: cls.confidence === 'baixa' ? 'baixa' : 'média',
    tags: [...new Set([...cls.tags, 'http-fallback'])],
  };
}

/**
 * Analisa uma URL e devolve o registro consumido pela tela e pelas exportações.
 *
 * `ctx` injeta `opts`, `doh`, `readTab`, `fetchFn` e `signal`. A classificação
 * permanece conservadora: ausência de evidência conclusiva resulta em indeterminado.
 */
export async function checkUrl(url, ctx) {
  const { opts = {} } = ctx;
  let u;
  try {
    u = new URL(url);
  } catch (err) {
    return {
      url, host: url, platform: null, platformName: null, kind: 'site',
      checkedAt: new Date().toISOString(), via: 'fetch', httpStatus: null, finalUrl: '', redirected: false,
      title: '', faviconUrl: '', status: 'indeterminado', reason: `URL invalida: ${(err && err.message) || err}`,
      confidence: 'baixa', tags: [], sha256: '', info: {},
    };
  }
  const platform = detectPlatform(u);
  if (ctx.signal && ctx.signal.aborted) {
    return {
      url, host: u.hostname, platform: platform ? platform.id : null, platformName: platform ? platform.name : null,
      kind: platform ? platform.kind : 'site', checkedAt: new Date().toISOString(), via: 'fetch',
      httpStatus: null, finalUrl: '', redirected: false, title: '', faviconUrl: '', status: 'indeterminado',
      reason: 'Análise cancelada pelo usuário', confidence: 'baixa', tags: ['cancelado'], sha256: '', info: {},
    };
  }
  const res = {
    url, host: u.hostname, platform: platform ? platform.id : null, platformName: platform ? platform.name : null,
    kind: platform ? platform.kind : 'site', checkedAt: new Date().toISOString(), via: 'fetch',
    httpStatus: null, finalUrl: '', redirected: false, title: '', faviconUrl: '', status: '', reason: '', confidence: '',
    tags: [], sha256: '', snippet: '', info: {},
  };

  const done = (cls) => {
    res.status = cls.status; res.reason = cls.reason; res.confidence = cls.confidence; res.tags = cls.tags || [];
    return res;
  };

  try {
    // Sonda por API pública (oEmbed, convites…): resposta definitiva quando existe
    if (platform && platform.probe) {
      let p = null;
      try { p = await platform.probe(u, { getJson: (x) => getJson(x, ctx) }); } catch { p = null; }
      if (p && p.status !== 'indeterminado') {
        res.via = 'api'; res.title = p.title || ''; res.info = { author: p.author || '', price: p.price || '' };
        return done(p);
      }
    }

    const isFacebookMarketplaceItem = platform && platform.id === 'facebook'
      && platform.kind === 'marketplace' && /^\/marketplace\/item\/\d+\/?$/i.test(u.pathname);
    let html;
    let tabRenderedText = '';
    let tabHeading = '';
    let tabHasPassword = false;
    let cls;
    const customRuleSettle = opts.customRules?.length ? 7000 : undefined;
    const tabWaitOptions = platform?.id === 'tiktok'
      ? /^\/@[^/]+\/?$/.test(u.pathname)
        ? { waitForTikTokProfile: true, tiktokWait: 20000 }
        : { settle: 8000 }
      : platform?.kind === 'advertisement'
        ? { settle: 8000 }
        : customRuleSettle ? { settle: customRuleSettle } : {};

    if (isFacebookMarketplaceItem && ctx.readTab) {
      res.via = 'tab';
      try {
        const readMarketplaceTab = () => ctx.readTab(url, {
          timeout: 12000,
          commandTimeout: 15000,
          waitForListing: true,
          listingWait: customRuleSettle ? 6500 : 4000,
          reuseTab: true,
          resolveHost: ctx.doh,
          signal: ctx.signal,
        });
        let t;
        try {
          t = await readMarketplaceTab();
        } catch (error) {
          const message = String((error && error.message) || error);
          if (!/no tab with id/i.test(message)) throw error;
          t = await readMarketplaceTab();
        }
        if (!t || typeof t !== 'object') throw new Error('Modo aba não retornou dados da página.');
        res.finalUrl = t.url || url;
        if (t.netError) {
          res.info.tabError = t.error || 'A navegação foi bloqueada ou não conseguiu carregar a página.';
          cls = { status: 'indeterminado', reason: 'Não foi possível ler o anúncio do Marketplace no modo aba', confidence: 'baixa', tags: [], meta: extractMeta(''), textN: '' };
        } else {
          html = t.html;
          tabRenderedText = t.text || '';
          tabHeading = t.heading || '';
          res.info.tabHeading = tabHeading;
          tabHasPassword = !!t.hasPassword;
          cls = classifyPage({
            url, finalUrl: t.url, status: null, html, platform, via: 'tab',
            renderedText: t.text, renderedHeading: t.heading, hasPassword: t.hasPassword,
            customRules: opts.customRules,
          });
        }
      } catch (e) {
        res.info.tabError = String((e && e.message) || e);
        cls = { status: 'indeterminado', reason: 'Falha ao ler o anúncio do Marketplace no modo aba', confidence: 'baixa', tags: [], meta: extractMeta(''), textN: '' };
      }
      if (cls.status === 'indeterminado' && res.info.tabError) {
        cls.reason += ` (${res.info.tabError})`;
      }
    } else {
      let page;
      let httpFallbackUsed = false;
      try {
        page = await fetchPage(url, ctx);
      } catch (err) {
        const opaqueRedirect = err instanceof NetworkSafetyError && err.kind === 'opaque-redirect';
        const canTryHttpFallback = u.protocol === 'https:'
          && !platform
          && (!(err instanceof NetworkSafetyError) || opaqueRedirect)
          && !ctx.signal?.aborted
          && (opaqueRedirect || err instanceof TypeError || err?.name === 'AbortError');
        if (canTryHttpFallback) {
          const httpUrl = new URL(url);
          httpUrl.protocol = 'http:';
          try {
            page = await fetchPage(httpUrl.href, ctx);
            httpFallbackUsed = true;
            res.info.httpFallback = 'Tentativa HTTP usada após falha da conexão HTTPS';
          } catch (fallbackError) {
            res.info.httpFallbackError = String((fallbackError && fallbackError.message) || fallbackError);
          }
        }

        if (!page) {
          const networkCls = await classifyNetworkError(res, u, err, platform, ctx);
          if (res.info.httpFallbackError) {
            networkCls.reason += ` (tentativa HTTP também falhou: ${res.info.httpFallbackError})`;
          }
          const tabPlatformEligible = platform && platform.needsBrowser && platform.tabSafe !== false;
          const tabErrorEligible = !(err instanceof NetworkSafetyError) || err.kind === 'opaque-redirect';
          const opaqueRedirectTabEligible = !platform && err instanceof NetworkSafetyError
            && err.kind === 'opaque-redirect';
          const shouldReadTab = (tabPlatformEligible || opaqueRedirectTabEligible)
            && opts.tabMode && ctx.readTab && !(ctx.signal && ctx.signal.aborted)
            && tabErrorEligible;
          if (tabPlatformEligible) {
            const blockers = [];
            if (!opts.tabMode) blockers.push('modo aba desativado');
            if (!ctx.readTab) blockers.push('leitor de aba indisponível');
            if (ctx.signal && ctx.signal.aborted) blockers.push('análise cancelada');
            if (!tabErrorEligible) blockers.push('erro de segurança não permite fallback');
            res.info.tabFallback = shouldReadTab ? 'Tentativa de leitura em aba iniciada' : `Não iniciada: ${blockers.join('; ')}`;
          }
          if (!shouldReadTab) return done(networkCls);

          res.info.tabAttempted = true;
          try {
            const t = await ctx.readTab(url, {
              ...tabWaitOptions,
              resolveHost: ctx.doh,
              signal: ctx.signal,
            });
            if (!t || typeof t !== 'object') throw new Error('Modo aba não retornou dados da página.');
            if (t.netError) {
              res.info.tabError = t.error || 'Navegador não conseguiu carregar a página.';
              res.info.tabFallback = 'A aba abriu, mas não carregou uma página legível';
              return done(networkCls);
            }
            res.via = 'tab';
            res.info.tabFallback = 'DOM da página lido em aba';
            html = t.html;
            tabRenderedText = t.text || '';
            tabHeading = t.heading || '';
            res.info.tabHeading = tabHeading;
            tabHasPassword = !!t.hasPassword;
            res.finalUrl = t.url || url;
            cls = classifyPage({
              url, finalUrl: t.url, status: null, html, platform, via: 'tab',
              renderedText: t.text, renderedHeading: t.heading, hasPassword: t.hasPassword,
              customRules: opts.customRules,
            });
          } catch (tabError) {
            res.info.tabError = String((tabError && tabError.message) || tabError);
            res.info.tabFallback = 'Tentativa de leitura em aba falhou';
            return done(networkCls);
          }
        }
      }
      if (page) {
        res.httpStatus = page.status; res.finalUrl = page.finalUrl; res.redirected = page.redirected;
        if (page.ct) res.info.contentType = page.ct;
        html = page.text;
        cls = classifyPage({
          url, finalUrl: page.finalUrl, status: page.status, html, platform, via: 'fetch',
          customRules: opts.customRules, contentType: page.ct,
        });
        if (httpFallbackUsed) {
          cls = markHttpFallback(cls);
        }

        // Facebook can return login pages, generic errors, or stale metadata without a DOM capture.
        const shouldReadTab = platform && platform.needsBrowser && platform.tabSafe !== false
          && opts.tabMode && ctx.readTab
          && (cls.status === 'indeterminado' || platform.id === 'facebook');
        if (shouldReadTab) {
          try {
            const t = await ctx.readTab(page.finalUrl, {
              ...tabWaitOptions,
              resolveHost: ctx.doh,
              signal: ctx.signal,
            });
            if (!t || typeof t !== 'object') throw new Error('Modo aba não retornou dados da página.');
            res.via = 'tab';
            if (t.netError) {
              cls = { status: 'indeterminado', reason: 'Navegador não conseguiu carregar a página', confidence: 'baixa', tags: [], meta: extractMeta(''), textN: '' };
            } else {
              html = t.html; res.finalUrl = t.url || res.finalUrl; res.httpStatus = null;
              tabHeading = t.heading || '';
              res.info.tabHeading = tabHeading;
              cls = classifyPage({
                url, finalUrl: t.url, status: null, html, platform, via: 'tab',
                renderedText: t.text, renderedHeading: t.heading, hasPassword: t.hasPassword,
                customRules: opts.customRules,
              });
            }
          } catch (e) {
            res.info.tabError = String((e && e.message) || e);
          }
        }
      }
    }

    const meta = cls.meta;
    if (tabHasPassword) meta.hasPassword = true;
    const pageTitle = meta.og['og:title'] || meta.title || '';
    const genericFacebookTitle = /^(?:\(\d+\)\s*)?facebook$/i.test(pageTitle.trim());
    const genericTikTokTitle = /^tiktok(?:\s*[-|].*)?$/i.test(pageTitle.trim());
    const facebookDescription = meta.og['og:description'] || tabRenderedText;
    const facebookDescriptionName = facebookDescription
      .match(/^(.+?)\s+(?:is on Facebook|está no Facebook)\./i)?.[1]?.trim();
    const facebookSlugTitle = facebookProfileSlugTitle(url) || facebookProfileSlugTitle(res.finalUrl);
    if (platform?.id === 'facebook' && (!pageTitle || genericFacebookTitle)) {
      res.title = tabHeading || facebookDescriptionName || facebookSlugTitle || pageTitle;
    } else if (platform?.id === 'tiktok' && (!pageTitle || genericTikTokTitle)) {
      res.title = tabHeading || pageTitle;
    } else {
      res.title = pageTitle;
    }
    if (meta.favicon) {
      try { res.faviconUrl = new URL(meta.favicon, res.finalUrl || url).href; } catch { /* ignora */ }
    }
    if (meta.product) res.info.product = meta.product;
    if (meta.og['og:description']) res.info.description = meta.og['og:description'].slice(0, 300);
    // Trecho curto do texto visível para contextualizar o resultado.
    res.snippet = tabRenderedText
      ? tabRenderedText.slice(0, 220)
      : html ? visibleText(html).slice(0, 220) : '';
    res.sha256 = html ? await sha256Hex(html) : '';
    return done(cls);
  } catch (err) {
    res.status = 'indeterminado'; res.reason = `Erro inesperado: ${(err && err.message) || err}`; res.confidence = 'baixa';
    return res;
  }
}
