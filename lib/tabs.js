// Abre a URL numa aba em segundo plano para
// ler o DOM já renderizado ("modo aba", necessário p/ SPAs: Shopee/Instagram/X/Facebook/TikTok).
//
// ATENÇÃO: a aba carrega a página de verdade no seu Chrome, com a sua sessão (cookies). Prefira um perfil de
// Chrome dedicado à investigação (ou uma VM): perfis logados deixam rastro ("quem viu seu perfil") e páginas
// maliciosas podem executar código.
// O guard valida navegações principais e chamadas XHR/Fetch; qualquer mudança deve preservar esse bloqueio.

import { assertPublicHttpUrl } from './networkSafety.js';
import { TIKTOK_PROFILE_EVIDENCE_WAIT_MS } from './config.js';

export { TIKTOK_PROFILE_EVIDENCE_WAIT_MS };

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

function isClosedTabError(error) {
  const message = String((error && error.message) || error);
  return /no tab with id|debugger is not attached|not attached to (?:the )?tab|target (?:was )?closed/i.test(message);
}

async function attachNetworkGuard(tabId, resolveHost, commandTimeout) {
  const target = { tabId };
  const pendingChildTabClosures = new Set();
  let childTabCloseError = null;
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
  const onTabCreated = (tab) => {
    if (tab.openerTabId !== tabId || tab.id === undefined) return;
    const closure = chrome.tabs.remove(tab.id).catch((error) => {
      const message = String((error && error.message) || error);
      if (!/no tab with id/i.test(message)) childTabCloseError ||= error;
    }).finally(() => pendingChildTabClosures.delete(closure));
    pendingChildTabClosures.add(closure);
  };

  await withStage(
    withTimeout(chrome.debugger.attach(target, '1.3'), commandTimeout, 'debugger.attach'),
    'chrome.debugger.attach',
  );
  chrome.debugger.onEvent.addListener(onEvent);
  chrome.tabs.onCreated?.addListener(onTabCreated);
  let downloadBehaviorConfigured = false;
  try {
    await send('Page.setDownloadBehavior', { behavior: 'deny' });
    downloadBehaviorConfigured = true;
  } catch (error) {
    console.warn('Bloqueio de downloads indisponível; a leitura em aba continuará sem essa proteção:', error);
  }
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
    chrome.tabs.onCreated?.removeListener(onTabCreated);
    if (downloadBehaviorConfigured) {
      try { await send('Page.setDownloadBehavior', { behavior: 'default' }); } catch { /* debugger indisponível */ }
    }
    try { await withTimeout(chrome.debugger.detach(target), commandTimeout, 'debugger.detach'); } catch { /* já desanexado */ }
    throw err;
  }

  return async () => {
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.tabs.onCreated?.removeListener(onTabCreated);
    await Promise.all([...pendingChildTabClosures]);
    let cleanupError = childTabCloseError && !isClosedTabError(childTabCloseError)
      ? childTabCloseError
      : null;
    if (downloadBehaviorConfigured) {
      try {
        await send('Page.setDownloadBehavior', { behavior: 'default' });
      } catch (error) {
        if (!isClosedTabError(error)) cleanupError ||= error;
      }
    }
    try { await send('Fetch.disable'); } catch { /* já desativado */ }
    try { await withTimeout(chrome.debugger.detach(target), commandTimeout, 'debugger.detach'); } catch { /* já desanexado */ }
    if (cleanupError) throw cleanupError;
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
  waitForFacebookContent = false,
  facebookWait = 0,
) {
  const EXEC_TIMEOUT_MS = waitForTikTokProfile
    ? tiktokWait + 5000
    : waitForFacebookContent
      ? facebookWait + 5000
    : waitForListing ? Math.min(12000, listingWait + 6000) : 10000;
  const results = await withStage(withTimeout(
    chrome.scripting.executeScript({
      target: { tabId },
      func: (
        shouldWaitForListing, maxListingWait, compactCapture,
        shouldWaitForTikTokProfile, maxTikTokWait, shouldWaitForFacebookContent, maxFacebookWait,
      ) => {
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
        if (!shouldWaitForListing && !shouldWaitForTikTokProfile && !shouldWaitForFacebookContent) return capture();

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
            const normalizedPageText = pageText.toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[’‘`´]/g, "'")
              .replace(/\s+/g, ' ');
            const combinedHeading = heading.toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[’‘`´]/g, "'")
              .replace(/\s+/g, ' ');
            const normalizedHeading = heading.toLowerCase().replace(/\s+/g, ' ');
            const genericHeading = /^(?:tiktok|for you|para voce|following|seguindo|friends|amigos|inbox|profile|perfil|discover|explorar|live|ao vivo|search|pesquisar|mensagens|atividade|novelas|carregar|mais|log ?in|sign ?in|sign ?up|entrar|cadastre-se|join tiktok|please wait)$/i
              .test(combinedHeading);
            const profileHeading = !!heading && !genericHeading;
            const accountUnavailablePattern = /couldn['’]t find (?:this|that) account|could not find (?:this|that) account|(?:this )?account (?:doesn't|does not) exist|account not found|profile not found|nao foi possivel (?:localizar|encontrar) (?:esta|essa|a) conta|(?:esta|essa) conta nao existe|conta nao encontrad[oa]/i;
            const accountUnavailable = accountUnavailablePattern.test(combinedHeading)
              || (!profileHeading && accountUnavailablePattern.test(normalizedPageText));
            const challenge = /\b(?:captcha|verify (?:you are|to continue)|too many requests|please wait|unusual traffic|security check|rate limit)\b|checking your browser/i
              .test(combinedHeading)
              || (!profileHeading && pageText.length <= 500 && /\b(?:captcha|verify (?:you are|to continue)|too many requests|please wait|unusual traffic|security check|rate limit)\b|checking your browser/i.test(pageText));
            if (accountUnavailable || challenge) return true;
            return !!heading
              && !genericHeading
              && !/please wait|checking your browser|verify you are human|unusual traffic/.test(normalizedHeading);
          };
          return waitForContent(isProfileReady, maxTikTokWait);
        }

        if (shouldWaitForFacebookContent) {
          const isFacebookContentReady = () => {
            const text = (document.body ? document.body.innerText : '')
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/\s+/g, ' ');
            const unavailable = /(?:este |esse |o )?conteudo nao esta disponivel no momento|content (?:isn.t|is not) available(?: right now)?|sorry, this page isn.t available|o conteudo que voce solicitou nao esta disponivel/i
              .test(text);
            const login = !!document.querySelector('input[type="password"]')
              || /(?:log in to facebook|entrar no facebook|inicie sessao para|faca login)/i.test(text);
            const profileContent = /\b\d[\d,.]*\s+(?:followers|seguidores)\b/.test(text)
              && /\b(?:posts|publicacoes|fotos|photos|about|sobre)\b/.test(text);
            const heading = [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')]
              .filter((element) => element.getClientRects().length)
              .map((element) => element.innerText?.trim() || '')
              .find((value) => value && !/^(?:\(\d+\)\s*)?facebook$/i.test(value));
            const settledPage = !!heading && text.length > 120;
            return unavailable || login || profileContent || settledPage;
          };
          return waitForContent(isFacebookContentReady, maxFacebookWait);
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
      args: [
        waitForListing, listingWait, compact, waitForTikTokProfile, tiktokWait,
        waitForFacebookContent, facebookWait,
      ],
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

async function readTabContentWithRetry(
  tabId, waitForListing, listingWait, signal, waitForTikTokProfile, tiktokWait,
  waitForFacebookContent, facebookWait,
) {
  // SPAs podem substituir o frame durante a navegação; só esses erros transitórios são repetidos.
  if (waitForTikTokProfile) {
    const deadline = Date.now() + tiktokWait;
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
  if (waitForFacebookContent) {
    const deadline = Date.now() + facebookWait;
    let lastError;
    while (Date.now() < deadline) {
      try {
        return await readTabContent(
          tabId, false, 0, false, false, 0, true, Math.max(1, deadline - Date.now()),
        );
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
    throw new Error('O Facebook não disponibilizou conteúdo legível para captura.');
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
let tiktokSession = null;

const TIKTOK_HOME_URL = 'https://www.tiktok.com/';

async function releaseReusableGuard() {
  const release = reusableGuardRelease;
  reusableGuardRelease = null;
  if (!release) return;
  try {
    await release();
  } catch (error) {
    if (!isClosedTabError(error)) throw error;
  }
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

/** Cria a janela e a aba exclusivas do TikTok para uma sessão de monitoramento. */
export async function openTikTokSession(resolveHost, {
  commandTimeout = 8000,
  timeout = 30000,
  signal,
} = {}) {
  if (tiktokSession) throw new Error('Já existe uma sessão TikTok aberta nesta janela de resultados.');
  if (signal?.aborted) throw new DOMException('Análise cancelada', 'AbortError');

  let browserWindow;
  let ownerWindowId;
  let tabId;
  let releaseGuard;
  try {
    const ownerWindow = await withStage(withTimeout(
      chrome.windows.getCurrent(),
      commandTimeout,
      'windows.getCurrent',
    ), 'chrome.windows.getCurrent');
    if (!Number.isInteger(ownerWindow?.id)) {
      throw new Error('Não foi possível identificar a janela de resultados.');
    }
    ownerWindowId = ownerWindow.id;
    browserWindow = await withStage(withTimeout(
      chrome.windows.create({
        url: 'about:blank',
        type: 'normal',
        width: 900,
        height: 750,
        state: 'normal',
        focused: true,
      }),
      commandTimeout,
      'windows.create',
    ), 'chrome.windows.create');
    if (!Number.isInteger(browserWindow?.id)) {
      throw new Error('O navegador não retornou o ID da janela TikTok.');
    }
    const registration = await withStage(withTimeout(
      chrome.runtime.sendMessage({
        type: 'mv.registerTikTokWindow',
        ownerWindowId,
        tiktokWindowId: browserWindow.id,
      }),
      commandTimeout,
      'registerTikTokWindow',
    ), 'chrome.runtime.sendMessage');
    if (!registration?.ok) {
      throw new Error(registration?.error || 'Não foi possível registrar a janela TikTok.');
    }

    const [tab] = await withStage(withTimeout(
      chrome.tabs.query({ active: true, windowId: browserWindow.id }),
      commandTimeout,
      'tabs.query',
    ), 'chrome.tabs.query');
    if (!Number.isInteger(tab?.id)) throw new Error('Não foi possível identificar a aba da janela TikTok.');
    tabId = tab.id;
    releaseGuard = await attachNetworkGuard(tabId, resolveHost, commandTimeout);
    if (signal?.aborted) throw new DOMException('Análise cancelada', 'AbortError');

    const loaded = waitComplete(tabId, timeout, signal);
    await withStage(withTimeout(
      chrome.tabs.update(tabId, { url: TIKTOK_HOME_URL }),
      commandTimeout,
      'tabs.update',
    ), 'chrome.tabs.update');
    await loaded.promise;

    const loadedTab = await withStage(withTimeout(
      chrome.tabs.get(tabId),
      commandTimeout,
      'tabs.get',
    ), 'chrome.tabs.get');
    if (!loadedTab.url || loadedTab.url.startsWith('chrome-error://')
        || (loadedTab.status && loadedTab.status !== 'complete')) {
      throw new Error('O navegador não conseguiu carregar a home do TikTok.');
    }

    tiktokSession = {
      windowId: browserWindow.id,
      ownerWindowId,
      tabId,
      releaseGuard,
    };
    return { windowId: browserWindow.id, tabId };
  } catch (error) {
    if (releaseGuard) {
      try {
        await releaseGuard();
      } catch (cleanupError) {
        if (!isClosedTabError(cleanupError)) {
          console.warn('Não foi possível liberar a proteção da sessão TikTok incompleta:', cleanupError);
        }
      }
    }
    if (Number.isInteger(ownerWindowId) && Number.isInteger(browserWindow?.id)) {
      try {
        await chrome.runtime.sendMessage({
          type: 'mv.releaseTikTokWindow',
          ownerWindowId,
          tiktokWindowId: browserWindow.id,
        });
      } catch (cleanupError) {
        console.warn('Não foi possível liberar a associação da janela TikTok incompleta:', cleanupError);
      }
    }
    if (Number.isInteger(browserWindow?.id)) {
      try {
        await chrome.windows.remove(browserWindow.id);
      } catch (cleanupError) {
        if (!/no window with id/i.test(String((cleanupError && cleanupError.message) || cleanupError))) {
          console.warn('Não foi possível fechar a janela TikTok incompleta:', cleanupError);
        }
      }
    }
    throw error;
  }
}

/** Fecha a janela TikTok exclusiva e libera o guard ao encerrar o lote. */
export async function closeTikTokSession() {
  const session = tiktokSession;
  tiktokSession = null;
  if (!session) return;

  let cleanupError = null;
  try {
    await session.releaseGuard();
  } catch (error) {
    if (!isClosedTabError(error)) cleanupError = error;
  }
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'mv.releaseTikTokWindow',
      ownerWindowId: session.ownerWindowId,
      tiktokWindowId: session.windowId,
    });
    if (!response?.ok) {
      cleanupError ||= new Error(response?.error || 'Não foi possível liberar a associação da janela TikTok.');
    }
  } catch (error) {
    cleanupError ||= error;
  }
  try {
    await chrome.windows.remove(session.windowId);
  } catch (error) {
    if (!/no window with id/i.test(String((error && error.message) || error))) {
      cleanupError ||= error;
    }
  }
  if (cleanupError) throw cleanupError;
}

/** Implementa a leitura isolada ou reutilizada, incluindo guard, espera e limpeza de recursos. */
async function readInTabOnce(url, {
  timeout = 30000,
  settle = 3500,
  commandTimeout = 8000,
  waitForListing = false,
  listingWait = 4000,
  reuseTab = false,
  useTikTokSession = false,
  waitForTikTokProfile = false,
  tiktokWait = TIKTOK_PROFILE_EVIDENCE_WAIT_MS,
  waitForFacebookContent = false,
  facebookWait = 8000,
  resolveHost,
  signal,
} = {}) {
  await tabSem.acquire();
  let tabId = null;
  let releaseGuard = null;
  const closeOnAbort = () => {
    if (tabId !== null && !useTikTokSession) {
      const id = tabId;
      tabId = null;
      chrome.tabs.remove(id).catch(() => {});
    }
  };
  try {
    if (signal?.aborted) throw new DOMException('Análise cancelada', 'AbortError');
    signal?.addEventListener('abort', closeOnAbort, { once: true });
    if (useTikTokSession) {
      if (!tiktokSession) throw new Error('A sessão TikTok dedicada não está aberta.');
      tabId = tiktokSession.tabId;
    } else if (reuseTab) {
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
    if (!waitForListing && !waitForTikTokProfile && !waitForFacebookContent) await sleep(settle, signal);
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
      waitForFacebookContent,
      facebookWait,
    );
  } finally {
    signal?.removeEventListener('abort', closeOnAbort);
    let cleanupError = null;
    try {
      if (!reuseTab && !useTikTokSession && releaseGuard) {
        try {
          await releaseGuard();
        } catch (error) {
          if (!isClosedTabError(error)) cleanupError = error;
        }
      }
    } finally {
      try {
        if (!reuseTab && !useTikTokSession && tabId !== null) {
          try {
            await chrome.tabs.remove(tabId);
          } catch (error) {
            if (!isClosedTabError(error)) cleanupError ||= error;
          }
        }
      } finally {
        tabSem.release();
      }
    }
    if (cleanupError) console.warn('Falha ao limpar os recursos do modo aba:', cleanupError);
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
