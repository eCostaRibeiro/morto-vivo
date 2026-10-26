// Resolução DNS via DNS-over-HTTPS (Cloudflare com fallback transparente para Google Public DNS).
// Serve para distinguir "domínio não existe" (NXDOMAIN) de "servidor fora do ar" quando o fetch falha.
// Observação de privacidade: o nome do host consultado é enviado aos provedores DoH utilizados.
// O cache é por instância (normalmente um lote) e guarda também a Promise para deduplicar consultas concorrentes.

import { isPublicIpAddress } from './networkSafety.js';

export const DOH_ENDPOINTS = [
  {
    name: 'Cloudflare',
    url: (host, type) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
  },
  {
    name: 'Google',
    url: (host, type) => `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
  },
];

export function makeDoh(fetchFn = fetch, timeoutMs = 6000) {
  const cache = new Map();

  async function queryEndpoint(endpoint, host, type) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetchFn(
        endpoint.url(host, type),
        { headers: { accept: 'application/dns-json' }, credentials: 'omit', cache: 'no-store', signal: ctl.signal, redirect: 'error' }
      );
      if (!r || !r.ok) throw new Error(`HTTP ${(r && r.status) || 'erro'}`);
      const json = await r.json();
      if (!json || typeof json.Status !== 'number') throw new Error('Resposta DoH inválida');
      return { json, provider: endpoint.name };
    } finally {
      clearTimeout(timer);
    }
  }

  async function query(host, type) {
    let lastError = null;
    for (const endpoint of DOH_ENDPOINTS) {
      try {
        return await queryEndpoint(endpoint, host, type);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Falha na consulta aos provedores DoH');
  }

  /**
   * Resolve A e AAAA em conjunto no formato consumido por networkSafety.js.
   * A Promise fica em cache para compartilhar consultas concorrentes no lote.
   */
  return function resolve(host) {
    if (cache.has(host)) return cache.get(host);
    const p = (async () => {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
        return {
          rcode: 0,
          nxdomain: false,
          hasAddress: true,
          addresses: [host],
          sinkhole: !isPublicIpAddress(host),
          provider: 'literal',
        };
      }
      const [aRes, aaaaRes] = await Promise.all([query(host, 'A'), query(host, 'AAAA')]);
      const a = aRes.json;
      const aaaa = aaaaRes.json;
      const provider = aRes.provider === aaaaRes.provider ? aRes.provider : `${aRes.provider}+${aaaaRes.provider}`;
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
        provider,
      };
    })();
    cache.set(host, p);
    return p;
  };
}
