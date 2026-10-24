// Normalização de URLs: "refang" de IOCs, validação e domínio registrável.

const MULTI_SLD = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'mil.br', 'app.br', 'blog.br', 'art.br', 'tv.br', 'eco.br',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.uy', 'com.py', 'com.bo',
  'com.ve', 'com.ec', 'com.au', 'net.au', 'co.jp', 'co.za', 'co.in', 'com.pt', 'com.tr', 'com.cn',
]);

/** Desfaz o "defang" comum em relatórios de CTI: hxxp, [.], (.), [:] ... */
export function refang(input) {
  return String(input)
    .trim()
    .replace(/^[<"'(]+|[>"'),;]+$/g, '')
    .replace(/^hxxp/i, 'http')
    .replace(/^fxp/i, 'ftp')
    .replace(/\[\s*:\s*\]/g, ':')
    .replace(/\[\s*\/\/\s*\]/g, '//')
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, '.')
    .replace(/\[@\]|\(at\)/gi, '@');
}

/** Defang para colar em relatórios/e-mails sem gerar link clicável. */
export function defang(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/\./g, '[.]');
    return `${u.protocol.replace('http', 'hxxp')}//${host}${u.port ? ':' + u.port : ''}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return String(url).replace(/^http/i, 'hxxp').replace(/\./g, '[.]');
  }
}

/**
 * Retorna a URL HTTP(S) normalizada ou null. Não é a validação de segurança de rede;
 * destinos precisam passar também por assertPublicHttpUrl antes de serem requisitados.
 */
export function normalizeUrl(input) {
  const raw = refang(input || '');
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '');
  const withProtocol = /^(https?:\/\/|\/\/)/i.test(cleaned) ? cleaned : 'https://' + cleaned;
  try {
    const parsed = new URL(withProtocol);
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname;
    if (!hostname || hostname.length > 253) return null;
    if (!/^[a-z0-9.-]+$/i.test(hostname)) return null;
    const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    if (!hostname.includes('.') && !isIp) return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/**
 * Aproxima o domínio registrável com uma lista local de sufixos comuns.
 * Não substitui a Public Suffix List completa; atualize MULTI_SLD se a regra do projeto mudar.
 */
export function registrableDomain(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return MULTI_SLD.has(last2) ? p.slice(-3).join('.') : last2;
}

/** Primeiro rótulo do domínio registrável (ex.: "vivo" em login.vivo.com.br). */
export function sldLabel(host) {
  return registrableDomain(host).split('.')[0];
}

export function safeUrl(s) {
  try { return new URL(s); } catch { return null; }
}
