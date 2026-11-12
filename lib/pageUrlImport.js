import { normalizeUrl } from './normalize.js';

const URL_TEXT_PATTERN = /(?<![\w@.-])(?:https?:\/\/|hxxps?:\/\/|\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+(?::\d{1,5})?(?:\/[^\s<>"'`|,;]*)?/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/;
const PAGE_CHANGE_TIMEOUT_MS = 20000;
const PAGE_POLL_INTERVAL_MS = 400;

export function extractUrlsFromText(text) {
  const refanged = String(text ?? '')
    .replace(/hxxp/gi, 'http')
    .replace(/\[\s*\.\s*\]|\(\s*\.\s*\)|\{\s*\.\s*\}|\[\s*dot\s*\]|\(\s*dot\s*\)/gi, '.');
  const urls = [];
  const seen = new Set();
  for (const match of refanged.matchAll(URL_TEXT_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, '');
    const normalized = normalizeUrl(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function readPageSnapshot(advance) {
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none'
      && style.opacity !== '0'
      && !element.closest('[aria-hidden="true"]');
  };
  const pageText = document.body?.innerText || '';
  const signatureText = `${location.href}\n${pageText}`;
  let hash = 2166136261;
  for (let index = 0; index < signatureText.length; index++) {
    hash ^= signatureText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const fingerprint = `${location.href}:${hash >>> 0}`;

  if (!advance) {
    const textParts = [...new Set([...document.querySelectorAll(
      'a, td, [role="cell"], article, [role="article"], [role="listitem"]',
    )]
      .filter((element) => isVisible(element) && !element.closest('header, nav, footer, [role="navigation"]'))
      .map((element) => (element.innerText || element.textContent || '').trim())
      .filter(Boolean))].filter((value) =>
      /(?:https?:\/\/|hxxps?:\/\/|(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,})/i.test(value));
    return {
      text: textParts.length ? textParts.join('\n') : pageText,
      fingerprint,
      origin: location.origin,
    };
  }

  const controls = [...document.querySelectorAll('button, a, [role="button"]')].filter(isVisible);
  const labelOf = (element) => [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.innerText,
    element.textContent,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const unavailable = (element) => element.disabled
    || element.getAttribute('aria-disabled') === 'true'
    || element.getAttribute('tabindex') === '-1';

  const isPaginationControl = (element) => {
    let parent = element.parentElement;
    for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
      const containerLabel = [
        parent.getAttribute('aria-label'),
        parent.getAttribute('role'),
        typeof parent.className === 'string' ? parent.className : '',
      ].filter(Boolean).join(' ');
      const numberedControls = [...parent.querySelectorAll('button, a, [role="button"]')]
        .filter(isVisible)
        .filter((control) => /^\d+$/.test(labelOf(control)));
      if (/pagination|paginacao|paginator|pager|page-navigation|navigation/i.test(containerLabel)
          || parent.querySelector('[aria-current="page"]')
          || numberedControls.length >= 2
          || /\b\d[\d,.]*\s*[-–]\s*\d[\d,.]*\s+(?:of|de)\s+[\d,.]+\s+(?:results|resultados)\b/i.test(parent.innerText || '')) {
        return true;
      }
    }
    return false;
  };
  const explicitNext = controls.filter((element) =>
    /\b(?:next|next page|proxima|proximo|seguinte|avancar|avanca)\b/i.test(labelOf(element))
      && isPaginationControl(element));
  const arrowNext = controls.filter((element) => /^[›»>→]+$/.test(labelOf(element))
    && isPaginationControl(element));
  const nextControls = [...explicitNext, ...arrowNext];
  const next = [...explicitNext, ...arrowNext].find((element) => !unavailable(element));
  const hasNextControl = nextControls.some((element) => !unavailable(element));
  const hasDisabledNextControl = nextControls.some(unavailable);
  const paginationLandmark = [...document.querySelectorAll(
    '[aria-current="page"], [aria-label*="pagination" i], [class*="pagination" i], [class*="paginator" i], [class*="pager" i]',
  )].some(isVisible);
  const paginationDetected = nextControls.length > 0
    || paginationLandmark
    || /\b\d[\d,.]*\s*[-–]\s*\d[\d,.]*\s+(?:of|de)\s+[\d,.]+\s+(?:results|resultados)\b/i.test(pageText);
  if (!next) {
    return {
      fingerprint,
      origin: location.origin,
      hasNext: hasNextControl,
      hasDisabledNextControl,
      paginationDetected,
    };
  }

  if (next.tagName === 'A') {
    if (next.target && next.target !== '_self') {
      return { fingerprint, origin: location.origin, hasNext: true, clickError: 'O controle de próxima página abriria outra aba; navegação interrompida.' };
    }
    try {
      if (new URL(next.getAttribute('href'), location.href).origin !== location.origin) {
        return { fingerprint, origin: location.origin, hasNext: true, clickError: 'O controle de próxima página aponta para outra origem; navegação interrompida.' };
      }
    } catch {
      return { fingerprint, origin: location.origin, hasNext: true, clickError: 'O controle de próxima página tem um destino inválido.' };
    }
  }

  try {
    next.click();
    return { fingerprint, origin: location.origin, hasNext: true, clicked: true };
  } catch (error) {
    return {
      fingerprint,
      origin: location.origin,
      hasNext: true,
      clickError: `Não foi possível avançar a paginação: ${(error && error.message) || error}`,
    };
  }
}

function readPageFingerprint() {
  const pageText = document.body?.innerText || '';
  const signatureText = `${location.href}\n${pageText}`;
  let hash = 2166136261;
  for (let index = 0; index < signatureText.length; index++) {
    hash ^= signatureText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { fingerprint: `${location.href}:${hash >>> 0}`, origin: location.origin };
}

async function executeInTab(tabId, func, ...args) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!results?.length) throw new Error('O navegador não retornou o conteúdo da página aberta.');
  return results[0].result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPageChange(tabId, previousFingerprint, expectedOrigin, signal) {
  const deadline = Date.now() + PAGE_CHANGE_TIMEOUT_MS;
  let previousCandidate = '';
  let stableReads = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    if (signal?.aborted) return { cancelled: true };
    try {
      const { fingerprint, origin } = await executeInTab(tabId, readPageFingerprint);
      if (origin !== expectedOrigin) {
        return { error: 'A paginação saiu da origem da página inicial; leitura interrompida.' };
      }
      if (fingerprint !== previousFingerprint) {
        if (fingerprint === previousCandidate) stableReads++;
        else {
          previousCandidate = fingerprint;
          stableReads = 1;
        }
        if (stableReads >= 2) return { fingerprint };
      } else {
        previousCandidate = '';
        stableReads = 0;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(PAGE_POLL_INTERVAL_MS);
  }
  return {
    error: lastError
      ? `A página não atualizou após avançar. Detalhe: ${(lastError && lastError.message) || lastError}`
      : 'A página não apresentou novos resultados após avançar.',
  };
}

export async function collectUrlsFromTab(tabId, { signal, onProgress = () => {} } = {}) {
  const urls = [];
  const seenUrls = new Set();
  const seenPages = new Set();
  let pages = 0;

  while (true) {
    if (signal?.aborted) {
      return { urls, pages, complete: false, reason: 'Coleta cancelada.' };
    }

    const pageData = await executeInTab(tabId, readPageSnapshot, false);
    if (typeof pageData?.text !== 'string' || typeof pageData.fingerprint !== 'string'
        || typeof pageData.origin !== 'string') {
      throw new Error('A página aberta não retornou texto legível.');
    }
    if (seenPages.has(pageData.fingerprint)) {
      return { urls, pages, complete: false, reason: 'A paginação repetiu uma página já lida.' };
    }
    seenPages.add(pageData.fingerprint);
    pages++;

    for (const url of extractUrlsFromText(pageData.text)) {
      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        urls.push(url);
      }
    }
    onProgress({ pages, urls: urls.length });

    if (signal?.aborted) {
      return { urls, pages, complete: false, reason: 'Coleta cancelada.' };
    }

    let advanceResult;
    try {
      advanceResult = await executeInTab(tabId, readPageSnapshot, true);
    } catch (error) {
      const changed = await waitForPageChange(tabId, pageData.fingerprint, pageData.origin, signal);
      if (changed.fingerprint) continue;
      return {
        urls,
        pages,
        complete: false,
        reason: changed.error || `Não foi possível acionar a paginação. Detalhe: ${(error && error.message) || error}`,
      };
    }

    if (advanceResult?.clickError) {
      return { urls, pages, complete: false, reason: advanceResult.clickError };
    }
    if (!advanceResult?.clicked) {
      return {
        urls,
        pages,
        complete: !advanceResult?.paginationDetected || advanceResult.hasDisabledNextControl,
        reason: advanceResult?.paginationDetected && !advanceResult.hasDisabledNextControl
          ? 'A página contém paginação, mas não foi possível identificar uma próxima página habilitada.'
          : '',
      };
    }

    const changed = await waitForPageChange(tabId, advanceResult.fingerprint, pageData.origin, signal);
    if (changed.cancelled) return { urls, pages, complete: false, reason: 'Coleta cancelada.' };
    if (changed.error) return { urls, pages, complete: false, reason: changed.error };
  }
}
