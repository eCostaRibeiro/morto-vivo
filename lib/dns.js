// Resolução DNS via DNS-over-HTTPS (Cloudflare). Serve para distinguir
// "domínio não existe" (NXDOMAIN) de "servidor fora do ar" quando o fetch falha.
// Observação de privacidade: o nome do host consultado é enviado ao Cloudflare.
// O cache é por instância (normalmente um lote) e guarda também a Promise para deduplicar consultas concorrentes.

import { isPublicIpAddress } from './networkSafety.js';

export function makeDoh(fetchFn = fetch, timeoutMs = 6000) {
  const cache = new Map();

  async function query(host, type) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: 'application/dns-json' }, credentials: 'omit', cache: 'no-store', signal: ctl.signal, redirect: 'error' }
      );
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resolve A e AAAA em conjunto no formato consumido por networkSafety.js.
   * A Promise fica em cache para compartilhar consultas concorrentes no lote.
   */
  return function resolve(host) {
    if (cache.has(host)) return cache.get(host);
    const p = (async () => {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        return { rcode: 0, nxdomain: false, hasAddress: true, addresses: [host], sinkhole: !isPublicIpAddress(host) };
      }
      const [a, aaaa] = await Promise.all([query(host, 'A'), query(host, 'AAAA')]);
      const addresses = [
        ...(a.Answer || []).filter((x) => x.type === 1).map((x) => x.data),
        ...(aaaa.Answer || []).filter((x) => x.type === 28).map((x) => x.data),
      ];
      const rcode = addresses.length ? 0
        : a.Status === 3 && aaaa.Status === 3 ? 3
          : a.Status === 2 || aaaa.Status === 2 ? 2
            : a.Status;
      return {
        rcode,
        nxdomain: rcode === 3,
        servfail: rcode === 2,
        hasAddress: addresses.length > 0,
        addresses,
        sinkhole: addresses.length > 0 && addresses.some((ip) => !isPublicIpAddress(ip)),
      };
    })();
    cache.set(host, p);
    return p;
  };
}
