// Abre a URL numa aba em segundo plano para
// ler o DOM já renderizado ("modo aba", necessário p/ SPAs: Shopee/Instagram/X/Facebook/TikTok).
//
// ATENÇÃO: a aba carrega a página de verdade no seu Chrome, com a sua sessão (cookies). Prefira um perfil de
// Chrome dedicado à investigação (ou uma VM): perfis logados deixam rastro ("quem viu seu perfil") e páginas
// maliciosas podem executar código.
// O guard valida navegações principais e chamadas XHR/Fetch; qualquer mudança deve preservar esse bloqueio.

import { assertPublicHttpUrl } from './networkSafety.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(new DOMException('Análise cancelada', 'AbortError'));
    return;
  }
  const timer = setTimeout(finish, ms);
  function finish() {
    signal?.removeEventListener('abort', abort);
    resolve();
  }
  function abort() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    reject(new DOMException('Análise cancelada', 'AbortError'));
  }
  signal?.addEventListener('abort', abort, { once: true });
});
const TRANSIENT_TAB_ERROR = /no tab with id|frame with id \d+ was removed|no frame with id \d+|cannot find context with specified id/i;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function withStage(promise, stage) {
  try {
    return await promise;
  } catch (error) {
    const message = String((error && error.message) || error);
    throw new Error(`${stage}: ${message}`);
  }
}

async function attachNetworkGuard(tabId, resolveHost, commandTimeout) {
  const target = { tabId };
  const send = (method, params) => withTimeout(
    chrome.debugger.sendCommand(target, method, params),
    commandTimeout,
    method,
  ).catch((error) => {
    const message = String((error && error.message) || error);
    throw new Error(`chrome.debugger.${method}: ${message}`);
  });
  const onEvent = async (source, method, params) => {
    if (source.tabId !== tabId || method !== 'Fetch.requestPaused') return;
    try {
      const protocol = new URL(params.request.url).protocol;
      if (/^(?:about:|blob:|data:)$/.test(protocol)) {
        await send('Fetch.continueRequest', { requestId: params.requestId });
        return;
      }
      if (!/^https?:$/.test(protocol)) throw new Error('Esquema de rede não permitido');
      await assertPublicHttpUrl(params.request.url, resolveHost);
      await send('Fetch.continueRequest', { requestId: params.requestId });
    } catch {
      try {
        await send('Fetch.failRequest', {
          requestId: params.requestId,
          errorReason: 'BlockedByClient',
        });
      } catch { /* a navegação pode ter sido encerrada */ }
    }
  };

  await withStage(
    withTimeout(chrome.debugger.attach(target, '1.3'), commandTimeout, 'debugger.attach'),
    'chrome.debugger.attach',
  );
  chrome.debugger.onEvent.addListener(onEvent);
  try {
    // Limita a interceptação aos tipos de requisição que podem navegar ou buscar dados da página.
    await send('Fetch.enable', {
      patterns: [
        { urlPattern: '*', resourceType: 'Document' },
        { urlPattern: '*', resourceType: 'XHR' },
        { urlPattern: '*', resourceType: 'Fetch' },
      ],
    });
  } catch (err) {
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await withTimeout(chrome.debugger.detach(target), commandTimeout, 'debugger.detach'); } catch { /* já desanexado */ }
    throw err;
  }

  return async () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    try { await send('Fetch.disable'); } catch { /* já desativado */ }
    try { await withTimeout(chrome.debugger.detach(target), commandTimeout, 'debugger.detach'); } catch { /* já desanexado */ }
  };
}

function waitComplete(tabId, timeout, signal) {
  let finish;
  const promise = new Promise((resolve, reject) => {
    let settled = false;
    let navigationStarted = false;
    const cleanup = () => {
      clearTimeout(to);
      chrome.tabs.onUpdated.removeListener(onUpd);
      signal?.removeEventListener('abort', onAbort);
    };
    finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onUpd = (id, info) => {
      if (id !== tabId) return;
      if (info.status === 'loading') navigationStarted = true;
      else if (info.status === 'complete' && navigationStarted) finish();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Análise cancelada', 'AbortError'));
    };
    // Se a navegação não terminar no prazo, tenta ler o conteúdo que já foi carregado.
    const to = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(onUpd);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  return { promise, cancel: () => finish() };
}

async function readTabContent(
  tabId,
  waitForListing,
  listingWait,
  compact = waitForListing,
  waitForTikTokProfile = false,
  tiktokWait = 0,
) {
  const EXEC_TIMEOUT_MS = waitForTikTokProfile
    ? tiktokWait + 5000
    : waitForListing ? Math.min(12000, listingWait + 6000) : 10000;
  const results = await withStage(withTimeout(
    chrome.scripting.executeScript({
      target: { tabId },
      func: (shouldWaitForListing, maxListingWait, compactCapture, shouldWaitForTikTokProfile, maxTikTokWait) => {
        // Esta função é serializada e executada no contexto da página; não depende de imports da extensão.
        const capture = () => ({
          url: location.href,
          heading: (
            document.querySelector('[data-e2e="user-title"]')?.innerText?.trim()
            || [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')]
              .filter((element) => element.getClientRects().length)
              .map((element) => element.innerText?.trim() || '')
              .find((value) => value && !/^(?:\(\d+\)\s*)?facebook$/i.test(value))
          )?.slice(0, 300) || '',
          html: compactCapture
            ? (document.head ? document.head.outerHTML : '')
            : (document.documentElement ? document.documentElement.outerHTML.slice(0, 600000) : ''),
          text: document.body ? document.body.innerText.slice(0, 30000) : '',
          hasPassword: !!document.querySelector('input[type="password"]'),
        });
        if (location.href.startsWith('chrome-error://')) return { netError: true, url: location.href };
        if (!shouldWaitForListing && !shouldWaitForTikTokProfile) return capture();

        const waitForContent = (isReady, maxWait) => {
          if (isReady()) return Promise.resolve(capture());
          return new Promise((resolve) => {
            let timer;
            let checkTimer;
            const observer = new MutationObserver(() => {
              if (checkTimer) return;
              checkTimer = setTimeout(() => {
                checkTimer = null;
                if (!isReady()) return;
                observer.disconnect();
                clearTimeout(timer);
                resolve(capture());
              }, 250);
            });
            observer.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true });
            timer = setTimeout(() => {
              observer.disconnect();
              clearTimeout(checkTimer);
              resolve(capture());
            }, maxWait);
          });
        };

        if (shouldWaitForTikTokProfile) {
          const isProfileReady = () => {
            const heading = (
              document.querySelector('[data-e2e="user-title"]')?.innerText
              || [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')]
                .filter((element) => element.getClientRects().length)
                .map((element) => element.innerText?.trim() || '')
                .find(Boolean)
              || ''
            ).trim();
            const pageText = (document.body ? document.body.innerText : '')
              .replace(/\s+/g, ' ')
              .trim();
            const combined = `${heading} ${pageText}`.toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[’‘`´]/g, "'")
              .replace(/\s+/g, ' ');
            const accountUnavailable = /couldn['’]t find (?:this|that) account|could not find (?:this|that) account|(?:this )?account (?:doesn't|does not) exist|account not found|profile not found|nao foi possivel (?:localizar|encontrar) (?:esta|essa|a) conta|(?:esta|essa) conta nao existe|conta nao encontrad[oa]/i
              .test(combined);
            if (accountUnavailable) return true;
            const normalized = heading.toLowerCase().replace(/\s+/g, ' ');
            return !!heading
              && !/^(?:tiktok|for you|following|friends|inbox|profile|discover|live|search|log ?in|sign ?in|sign ?up|entrar|cadastre-se|join tiktok|please wait)$/i.test(normalized)
              && !/please wait|checking your browser|verify you are human|unusual traffic/.test(normalized);
          };
          return waitForContent(isProfileReady, maxTikTokWait);
        }

        const isReady = () => {
          const title = document.title.toLowerCase();
          const listingTitle = /\bfacebook marketplace\b|\bmarketplace\s+[—–-]\s+.+\|\s*facebook\b/i.test(title);
          const loginRoute = /^\/(?:login(?:\.php)?|checkpoint|recover|consent)(?:\/|$)/i.test(location.pathname);
          if (loginRoute) return true;
          const text = (document.body ? document.body.innerText : '')
            .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
          if (!listingTitle) {
            return /(?:this|the) listing (?:is no longer available|isn.t available anymore|is not available)|(?:este|esse|o) anuncio (?:nao esta mais disponivel|nao esta disponivel|foi removido|foi excluido)/.test(text);
          }
          const context = /\b(?:listed|posted)\s+\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b|\b(?:anunciad[oa]|publicad[oa])\s+(?:ha\s+)?\d+\s+(?:minutos?|horas?|dias?|semanas?|meses?|anos?)\b|\b(?:listed|posted|anunciad[oa]|publicad[oa])\s+(?:today|yesterday|hoje|ontem)\b|\b(?:listed in|in stock|public meetup|door dropoff)\b/.test(text);
          const price = /(?:\br\$\s?\d|\b(?:us\$|c\$|a\$)\s?\d|[$€£]\s?\d|\b\d[\d.,]*\s?(?:brl|usd|eur)\b|\b(?:free|gratis|gratuito)\b)/.test(text);
          const details = /\b(?:seller information|seller details|condition|informacoes do vendedor|detalhes do vendedor|informacoes do anunciante|condicao)\b/.test(text);
          return context && price && details;
        };

        return waitForContent(isReady, maxListingWait);
      },
      args: [waitForListing, listingWait, compact, waitForTikTokProfile, tiktokWait],
    }),
    EXEC_TIMEOUT_MS,
    'executeScript',
  ), 'chrome.scripting.executeScript');
  const result = results?.[0]?.result;
  if (!result || typeof result !== 'object') {
    throw new Error('A página não retornou conteúdo legível para análise.');
  }
  return result;
}

async function readTabContentWithRetry(tabId, waitForListing, listingWait, signal, waitForTikTokProfile, tiktokWait) {
  // SPAs podem substituir o frame durante a navegação; só esses erros transitórios são repetidos.
  if (waitForTikTokProfile) {
    const deadline = Date.now() + tiktokWait + 1000;
    let lastError;
    while (Date.now() < deadline) {
      try {
        return await readTabContent(tabId, false, 0, false, true, Math.max(1, deadline - Date.now()));
      } catch (error) {
        const message = String((error && error.message) || error);
        if (/chrome\.scripting\.executeScript: timeout: executeScript/i.test(message)) {
          return readTabContent(tabId, false, 0);
        }
        if (/no tab with id/i.test(message)) throw error;
        if (!TRANSIENT_TAB_ERROR.test(message)) throw error;
        lastError = error;
        await sleep(Math.min(200, Math.max(1, deadline - Date.now())), signal);
      }
    }
    if (lastError) throw lastError;
    throw new Error('A navegação não disponibilizou o perfil TikTok para leitura.');
  }
  const deadline = Date.now() + (waitForListing ? listingWait : 4000);
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await readTabContent(tabId, true, Math.max(1, deadline - Date.now()));
    } catch (error) {
      const message = String((error && error.message) || error);
      if (/chrome\.scripting\.executeScript: timeout: executeScript/i.test(message)) {
        return readTabContent(tabId, false, 0, true);
      }
      if (/no tab with id/i.test(message)) throw error;
      if (!TRANSIENT_TAB_ERROR.test(message)) throw error;
      lastError = error;
      await sleep(Math.min(200, Math.max(1, deadline - Date.now())), signal);
    }
  }
  if (lastError) throw lastError;
  throw new Error('A navegação não disponibilizou o frame principal para leitura do anúncio.');
}

class Semaphore {
  constructor(n) { this.n = n; this.q = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.q.push(r)); }
  release() { const r = this.q.shift(); if (r) r(); else this.n++; }
}
const tabSem = new Semaphore(1);
let reusableTabId = null;
let reusableGuardRelease = null;

async function releaseReusableGuard() {
  const release = reusableGuardRelease;
  reusableGuardRelease = null;
  if (release) await release();
}

async function getReusableTab(commandTimeout) {
  if (reusableTabId !== null) {
    try {
      await withTimeout(chrome.tabs.get(reusableTabId), commandTimeout, 'tabs.get');
      return reusableTabId;
    } catch (error) {
      const message = String((error && error.message) || error);
      if (!/no tab with id/i.test(message)) throw error;
      await releaseReusableGuard();
      reusableTabId = null;
    }
  }
  const tab = await withStage(withTimeout(
    chrome.tabs.create({ url: 'about:blank', active: false }),
    commandTimeout,
    'tabs.create',
  ), 'chrome.tabs.create');
  reusableTabId = tab.id;
  return tab.id;
}

/**
 * Fecha a aba compartilhada e remove o guard associado, se houver.
 * Erros diferentes de uma aba já removida são propagados ao chamador.
 */
export async function closeReusableTab() {
  const tabId = reusableTabId;
  reusableTabId = null;
  await releaseReusableGuard();
  if (tabId === null) return;
  try { await chrome.tabs.remove(tabId); } catch (error) {
    const message = String((error && error.message) || error);
    if (!/no tab with id/i.test(message)) throw error;
  }
}

/** Implementa a leitura isolada ou reutilizada, incluindo guard, espera e limpeza de recursos. */
async function readInTabOnce(url, {
  timeout = 30000,
  settle = 3500,
  commandTimeout = 8000,
  waitForListing = false,
  listingWait = 4000,
  reuseTab = false,
  waitForTikTokProfile = false,
  tiktokWait = 20000,
  resolveHost,
  signal,
} = {}) {
  await tabSem.acquire();
  let tabId = null;
  let releaseGuard = null;
  const closeOnAbort = () => {
    if (tabId !== null) {
      const id = tabId;
      tabId = null;
      chrome.tabs.remove(id).catch(() => {});
    }
  };
  try {
    if (signal?.aborted) throw new DOMException('Análise cancelada', 'AbortError');
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    if (reuseTab) {
      tabId = await getReusableTab(commandTimeout);
      if (!reusableGuardRelease) {
        reusableGuardRelease = await attachNetworkGuard(tabId, resolveHost, commandTimeout);
      }
    }
    else {
      const tab = await withStage(withTimeout(
        chrome.tabs.create({ url: 'about:blank', active: false }),
        commandTimeout,
        'tabs.create',
      ), 'chrome.tabs.create');
      tabId = tab.id;
      releaseGuard = await attachNetworkGuard(tabId, resolveHost, commandTimeout);
    }
    if (signal?.aborted) throw new DOMException('Análise cancelada', 'AbortError');
    const loaded = waitComplete(tabId, timeout, signal);
    await withStage(withTimeout(
      chrome.tabs.update(tabId, { url }),
      commandTimeout,
      'tabs.update',
    ), 'chrome.tabs.update');
    await loaded.promise;
    if (!waitForListing && !waitForTikTokProfile) await sleep(settle, signal);
    const t = await withStage(
      withTimeout(chrome.tabs.get(tabId), commandTimeout, 'tabs.get'),
      'chrome.tabs.get',
    );
    if (!t.url || t.url.startsWith('chrome-error://')) return { netError: true, url: t.url || url };
    return await readTabContentWithRetry(
      tabId,
      waitForListing,
      listingWait,
      signal,
      waitForTikTokProfile,
      tiktokWait,
    );
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    if (!reuseTab && releaseGuard) await releaseGuard();
    if (!reuseTab && tabId !== null) { try { await chrome.tabs.remove(tabId); } catch { /* já fechada */ } }
    tabSem.release();
  }
}

/**
 * Lê o DOM renderizado de uma URL compatível com modo aba.
 * `options` aceita sinal de cancelamento, resolvedor DNS e limites de espera.
 * Retorna URL/texto/HTML capturados ou `netError`; falhas não transitórias são propagadas.
 */
export async function readInTab(url, options) {
  try {
    return await readInTabOnce(url, options);
  } catch (error) {
    const message = String((error && error.message) || error);
    if (options?.signal?.aborted || !TRANSIENT_TAB_ERROR.test(message)) throw error;
    await sleep(200, options?.signal);
    return readInTabOnce(url, options);
  }
}
