// Baixa e incorpora o favicon; falha ao coletar evidência não deve mudar o status do link.

import { fetchPublicResource } from './networkSafety.js';
import { FAVICON_TIMEOUT_MS } from './config.js';

const faviconCache = new Map();
const MAX_FAVICON_CACHE_ENTRIES = 128;

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Tenta candidatos em ordem e retorna o primeiro favicon embutido como data URL.
 * A requisição passa pela validação de rede e o cache guarda Promises concorrentes.
 */
export async function embedFavicon(candidates, fetchFn = fetch, resolveHost) {
  for (const url of candidates.filter(Boolean)) {
    let request = faviconCache.get(url);
    if (!request) {
      request = fetchFavicon(url, fetchFn, resolveHost);
      faviconCache.set(url, request);
      while (faviconCache.size > MAX_FAVICON_CACHE_ENTRIES) {
        faviconCache.delete(faviconCache.keys().next().value);
      }
    }
    const data = await request;
    if (data) return data;
    if (faviconCache.get(url) === request) faviconCache.delete(url);
  }
  return '';
}

async function fetchFavicon(url, fetchFn, resolveHost) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FAVICON_TIMEOUT_MS);
  try {
    const { response: r } = await fetchPublicResource(url, {
      credentials: 'omit', cache: 'no-store', signal: ctl.signal,
    }, { fetchFn, resolveHost });
    if (!r.ok) return '';
    const mime = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 20 || buf.byteLength > 150000) return '';
    if (mime && !/^image\//.test(mime) && !/octet-stream/.test(mime)) return '';
    return `data:${/^image\//.test(mime) ? mime : 'image/x-icon'};base64,${toBase64(buf)}`;
  } catch { return ''; } finally { clearTimeout(timer); }
}

/** Houve resposta da página (ou API/aba)? */
export function hasPage(res) {
  return res.httpStatus != null || res.via === 'tab' || res.via === 'api';
}

/** Acrescenta favicon ao resultado usando a mesma validação de destino da análise de rede. */
export async function enrich(res, { fetchFn = fetch, doh } = {}) {
  if (!hasPage(res)) return res;
  let origin = '';
  try { origin = new URL(res.finalUrl || res.url).origin; } catch { /* ignora */ }

  res.faviconData = await embedFavicon([res.faviconUrl, origin && `${origin}/favicon.ico`], fetchFn, doh);
  return res;
}
