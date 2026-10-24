// Utilitários de HTML/texto sem DOM (rodam em página de extensão e em Node para testes).
// Nada aqui executa scripts da página analisada: só regex sobre o texto bruto.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** minúsculas, sem acentos, apóstrofos normalizados, espaços colapsados. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseAttrs(tag) {
  const attrs = {};
  const inner = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(inner))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function visibleText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function flattenLd(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((n) => flattenLd(n, out)); return; }
  if (node['@graph']) flattenLd(node['@graph'], out);
  out.push(node);
}

function firstOffer(offers) {
  if (!offers) return null;
  return Array.isArray(offers) ? offers[0] : offers;
}

/**
 * Extrai metadados sem DOM e sem executar conteúdo de terceiros.
 * Limites em listas/campos evitam que páginas grandes gerem estruturas desnecessárias.
 */
export function extractMeta(html) {
  html = String(html || '');
  const out = {
    title: '', og: {}, meta: {}, favicon: '', forms: [], hasPassword: false,
    fieldNames: [], product: null, refresh: '', obfuscated: false,
  };

  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) out.title = decodeEntities(t[1]).replace(/\s+/g, ' ').trim().slice(0, 300);

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag);
    const key = (a.property || a.name || a['http-equiv'] || '').toLowerCase();
    if (!key || a.content === undefined) continue;
    const val = a.content.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (key.startsWith('og:') || key.startsWith('product:')) { if (!(key in out.og)) out.og[key] = val; }
    else if (!(key in out.meta)) out.meta[key] = val;
  }
  if (out.meta.refresh) out.refresh = out.meta.refresh;

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag);
    if (a.href && /\bicon\b/i.test(a.rel || '')) { out.favicon = a.href; break; }
  }

  for (const tag of html.match(/<form\b[^>]*>/gi) || []) {
    const a = parseAttrs(tag);
    out.forms.push({ action: a.action || '', method: (a.method || 'get').toLowerCase() });
  }
  for (const tag of (html.match(/<input\b[^>]*>/gi) || []).slice(0, 200)) {
    const a = parseAttrs(tag);
    if ((a.type || '').toLowerCase() === 'password') out.hasPassword = true;
    const n = a.name || a.id || a.placeholder;
    if (n && out.fieldNames.length < 60) out.fieldNames.push(n.toLowerCase());
  }

  const ld = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { flattenLd(JSON.parse(m[1].trim()), ld); } catch { /* JSON-LD inválido */ }
  }
  const prod = ld.find((n) => [].concat(n['@type'] || []).some((x) => /product/i.test(String(x))));
  if (prod) {
    const o = firstOffer(prod.offers) || {};
    out.product = {
      name: prod.name || '',
      price: o.price ?? o.lowPrice ?? '',
      currency: o.priceCurrency || '',
      brand: (prod.brand && (prod.brand.name || prod.brand)) || '',
      seller: (o.seller && (o.seller.name || o.seller)) || '',
    };
  }
  if (!out.product && (out.og['og:price:amount'] || out.og['product:price:amount'])) {
    out.product = {
      name: out.og['og:title'] || '',
      price: out.og['og:price:amount'] || out.og['product:price:amount'],
      currency: out.og['og:price:currency'] || out.og['product:price:currency'] || '',
      brand: '', seller: '',
    };
  }

  out.obfuscated = /eval\(\s*(atob|unescape|String\.fromCharCode)|document\.write\(\s*unescape|atob\(\s*['"][A-Za-z0-9+\/=]{200,}/.test(html);
  return out;
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(String(text ?? ''));
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
