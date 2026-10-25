// Pontuação de risco de "página/anúncio/perfil falso" + parser da lista de marcas monitoradas.
// É um indicador para PRIORIZAR análise humana, não um veredito.

import { norm } from './text.js';
import { registrableDomain, sldLabel, safeUrl } from './normalize.js';

/**
 * Formato (uma marca por linha):
 *   Nome = dominio-oficial1.com.br, dominio2.com | termo extra, outro termo
 * Linhas iniciadas por # são ignoradas; tokens de marca com menos de 3 caracteres e palavras-chave
 * com menos de 4 são descartados para reduzir correspondências acidentais.
 */
export function parseBrands(text) {
  const brands = [];
  for (const line of String(text || '').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const [left, kwPart = ''] = l.split('|');
    const [namePart, domPart = ''] = left.split('=');
    const name = namePart.trim();
    if (!name) continue;
    const token = norm(name).replace(/[^a-z0-9]/g, '');
    const domains = domPart.split(',').map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean).map(registrableDomain);
    const keywords = kwPart.split(',').map((k) => norm(k).replace(/[^a-z0-9]/g, '')).filter((k) => k.length >= 4);
    if (token.length >= 3) brands.push({ name, token, domains: [...new Set(domains)], keywords });
  }
  return brands;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Troca caracteres confundíveis (0→o, 1→l, 3→e, rn→m, vv→w ...) antes de comparar. */
export function deHomoglyph(s) {
  return s
    .replace(/xn--/g, '')
    .replace(/0/g, 'o').replace(/[1|i]/g, 'l').replace(/3/g, 'e').replace(/5/g, 's').replace(/4/g, 'a').replace(/8/g, 'b')
    .replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd');
}

function rel(href, base) {
  try { return new URL(href, base); } catch { return null; }
}

/** Marca "contida" no host. Tokens curtos (<=4) exigem rótulo exato ou rótulo + palavra de isca, p/ evitar "tim" em "ultimate". */
function hostHasBrand(host, token) {
  const compact = host.replace(/[^a-z0-9]/g, '');
  if (token.length >= 6) return compact.includes(token);
  const labels = host.split(/[.\-]/);
  if (labels.includes(token)) return true;
  return labels.some((l) => l.includes(token) && HOST_KEYWORDS.some((k) => l.includes(k)));
}

const SUSPICIOUS_TLD = /\.(top|xyz|click|online|site|icu|live|vip|cc|tk|ml|ga|cf|gq|cfd|sbs|lol|buzz|rest|store|link|support|help|shop|work|monster|cyou|one|fun|today)$/;
const HOST_KEYWORDS = ['login', 'secure', 'seguro', 'verify', 'verifica', 'atualiza', 'update', 'conta', 'account', 'boleto', 'fatura', '2via', 'segundavia', 'pix', 'cadastro', 'promo', 'oferta', 'sorteio', 'premio', 'resgate', 'suporte', 'atendimento', 'portal', 'cliente', 'recarga', 'desbloqueio', 'regulariza', 'negocia', 'acesso', 'app'];
const SENSITIVE_FIELDS = /cpf|cartao|card|cvv|cvc|senha|password|token|pix|nascimento|mae/;

function push(signals, id, label, weight) {
  if (!signals.some((s) => s.id === id)) signals.push({ id, label, weight });
}

/**
 * Gera sinais explicáveis para triagem humana; o score nunca altera a classificação vivo/morto.
 * `brands` deve vir de parseBrands(); `meta` deve seguir o formato de extractMeta().
 */
export function assessRisk({ url, finalUrl, meta, textN = '', platform, brands = [], status }) {
  const signals = [];
  const u = safeUrl(finalUrl || url);
  const orig = safeUrl(url);
  if (!u) return { score: 0, level: 'nenhum', signals, brands: [] };
  const host = u.hostname.toLowerCase();
  const rd = registrableDomain(host);
  const hostCompact = host.replace(/[^a-z0-9]/g, '');
  const matchedBrands = new Set();
  const onPlatform = !!platform && platform.kind !== 'site';

  // ----- sinais só da URL (valem mesmo para link morto: continua sendo um IOC) -----
  if (!onPlatform) {
    if (/(^|\.)xn--/.test(host)) push(signals, 'punycode', 'Domínio com punycode (IDN/homógrafo)', 20);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) push(signals, 'ip', 'Host é um endereço IP', 20);
    if (SUSPICIOUS_TLD.test(host)) push(signals, 'tld', 'TLD frequentemente usado em fraude', 8);
    if (host.split('.').length >= 5) push(signals, 'subs', 'Muitos subdomínios', 8);
    if ((host.match(/-/g) || []).length >= 2) push(signals, 'hyphens', 'Vários hífens no domínio', 8);
    if (host.length > 40) push(signals, 'long', 'Hostname muito longo', 5);
    const kw = HOST_KEYWORDS.filter((k) => hostCompact.includes(k));
    if (kw.length) push(signals, 'hostkw', `Palavras de isca no domínio: ${kw.slice(0, 4).join(', ')}`, Math.min(20, kw.length * 10));
  }

  for (const b of brands) {
    const legit = b.domains.some((d) => rd === d || host.endsWith('.' + d));
    const title = norm((meta && (meta.og['og:title'] || meta.title)) || '');
    const desc = norm((meta && (meta.og['og:description'] || meta.meta.description)) || '');

    if (!onPlatform) {
      if (legit) continue;
      if (hostHasBrand(host, b.token)) {
        push(signals, `brand-host-${b.token}`, `Domínio contém a marca "${b.name}" mas não é oficial`, 35); matchedBrands.add(b.name);
      } else {
        const labels = [sldLabel(host), ...sldLabel(host).split('-')].map((x) => deHomoglyph(x.replace(/[^a-z0-9]/g, ''))).filter((x) => x.length >= 3);
        const tok = deHomoglyph(b.token);
        const maxD = tok.length >= 8 ? 2 : tok.length >= 5 ? 1 : 0;
        if (tok.length >= 4 && labels.some((x) => levenshtein(x, tok) <= maxD)) {
          push(signals, `typo-${b.token}`, `Domínio parecido com "${b.name}" (typosquatting)`, 35); matchedBrands.add(b.name);
        }
      }
      if (b.keywords.some((k) => hostCompact.includes(k))) { push(signals, `brandkw-${b.token}`, `Domínio contém termo associado a "${b.name}"`, 20); matchedBrands.add(b.name); }
      if (status === 'vivo' || status === 'zumbi') {
        const mentions = textN.split(b.token).length - 1;
        if (title.includes(b.token) || mentions >= 3) { push(signals, `brand-content-${b.token}`, `Conteúdo usa a marca "${b.name}" fora dos domínios oficiais`, 25); matchedBrands.add(b.name); }
        const fav = meta && meta.favicon && rel(meta.favicon, u);
        if (fav && b.domains.includes(registrableDomain(fav.hostname)) && rd !== registrableDomain(fav.hostname)) {
          push(signals, `favicon-${b.token}`, `Favicon carregado do domínio oficial de "${b.name}" (clone)`, 20); matchedBrands.add(b.name);
        }
      }
    } else if (status === 'vivo' || status === 'zumbi') {
      const handle = norm(u.pathname.split('/').filter(Boolean)[0] || '').replace(/[^a-z0-9]/g, '');
      if (platform.kind === 'social' || platform.kind === 'messaging') {
        if (handle && (handle.includes(b.token) || levenshtein(deHomoglyph(handle), b.token) <= 1)) {
          push(signals, `handle-${b.token}`, `Handle/URL parece usar a marca "${b.name}"`, 25); matchedBrands.add(b.name);
        }
      }
      if (title.includes(b.token) || desc.includes(b.token) || b.keywords.some((k) => title.includes(k) || desc.includes(k))) {
        push(signals, `mention-${b.token}`, `${platform.kind === 'marketplace' ? 'Anúncio' : 'Perfil/post'} menciona "${b.name}" — verificar se é legítimo`, 15); matchedBrands.add(b.name);
      }
    }
  }

  // ----- sinais de conteúdo (só se a página respondeu) -----
  if (meta && (status === 'vivo' || status === 'zumbi') && !onPlatform) {
    if (meta.hasPassword) push(signals, 'password', 'Página tem campo de senha', 15);
    const sens = meta.fieldNames.filter((n) => SENSITIVE_FIELDS.test(n));
    if (sens.length) push(signals, 'sensitive', `Coleta dados sensíveis (${[...new Set(sens)].slice(0, 4).join(', ')})`, 15);
    for (const f of meta.forms) {
      if (!f.action) continue;
      const a = rel(f.action, u);
      if (!a) continue;
      if (registrableDomain(a.hostname) !== rd) { push(signals, 'form-x', `Formulário envia dados para outro domínio (${registrableDomain(a.hostname)})`, 15); }
      if (a.protocol === 'http:') push(signals, 'form-http', 'Formulário envia por HTTP sem criptografia', 5);
    }
    if (meta.obfuscated) push(signals, 'obf', 'JavaScript ofuscado (eval/atob)', 10);
    if (meta.refresh) push(signals, 'refresh', 'Meta refresh redireciona automaticamente', 5);
  }
  if (orig && u && registrableDomain(orig.hostname) !== rd && !onPlatform) {
    push(signals, 'redir', `Redireciona para outro domínio (${rd})`, 10);
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  const level = score >= 60 ? 'alto' : score >= 30 ? 'médio' : score > 0 ? 'baixo' : 'nenhum';
  return { score, level, signals, brands: [...matchedBrands] };
}
