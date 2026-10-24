const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// Defesa em profundidade para requisições feitas pela extensão; não fixa o IP do socket
// e, portanto, não elimina por completo o risco de DNS rebinding descrito no README.
export class NetworkSafetyError extends Error {
  constructor(message, kind = 'unsafe-target') {
    super(message);
    this.name = 'NetworkSafetyError';
    this.kind = kind;
  }
}

function ipv4IsPublic(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
  );
}

function parseIpv6(host) {
  let value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!value.includes(':') || value.includes('%')) return null;
  const dotted = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const bytes = dotted[1].split('.').map(Number);
    if (bytes.some((part) => part < 0 || part > 255)) return null;
    value = value.slice(0, -dotted[1].length) + `${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill('0'), ...right].map((part) => parseInt(part, 16));
}

export function isPublicIpAddress(address) {
  const value = String(address).toLowerCase().replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return ipv4IsPublic(value);
  const groups = parseIpv6(value);
  if (!groups) return false;
  const mapped = groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff;
  if (mapped) {
    return ipv4IsPublic([
      groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255,
    ].join('.'));
  }
  const globallyRoutable = (groups[0] & 0xe000) === 0x2000;
  const special2001 = groups[0] === 0x2001 && groups[1] <= 0x01ff;
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
  const sixbone = groups[0] === 0x3ffe;
  const sixToFour = groups[0] === 0x2002;
  const nat64 = groups[0] === 0x0064 && groups[1] === 0xff9b;
  const ipv6Documentation = groups[0] === 0x3fff;
  return globallyRoutable && !special2001 && !documentation && !sixbone && !sixToFour && !nat64 && !ipv6Documentation;
}

function validateHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new NetworkSafetyError('Destino de rede inválido; requisição bloqueada por segurança.'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new NetworkSafetyError('Apenas destinos HTTP(S) públicos são permitidos; requisição bloqueada por segurança.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home\.arpa)$/.test(host)
      || (!host.includes('.') && !host.includes(':'))) {
    throw new NetworkSafetyError('Destino local ou reservado bloqueado por segurança.');
  }
  return { url, host };
}

export async function assertPublicHttpUrl(value, resolveHost) {
  const { url, host } = validateHttpUrl(value);
  if (host.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    if (!isPublicIpAddress(host)) throw new NetworkSafetyError('Endereço IP privado ou reservado bloqueado por segurança.');
    return url;
  }
  if (typeof resolveHost !== 'function') {
    throw new NetworkSafetyError('Não foi possível validar o destino DNS; requisição bloqueada por segurança.');
  }
  let result;
  try { result = await resolveHost(host); } catch {
    throw new NetworkSafetyError('Falha na validação DNS; requisição bloqueada por segurança.');
  }
  if (result?.nxdomain && !result.addresses?.length) {
    throw new NetworkSafetyError('Domínio não existe (NXDOMAIN)', 'nxdomain');
  }
  if (!result || !result.hasAddress || !result.addresses?.length
      || result.addresses.some((address) => !isPublicIpAddress(address))) {
    throw new NetworkSafetyError('O DNS não confirmou um destino exclusivamente público; requisição bloqueada por segurança.');
  }
  return url;
}

export async function fetchPublicResource(value, options, { fetchFn = fetch, resolveHost } = {}) {
  // Redirect manual: cada destino é validado antes da próxima requisição; redirects opacos falham fechados.
  let current = value;
  const visited = new Set();
  for (let hop = 0; hop <= 5; hop++) {
    const url = await assertPublicHttpUrl(current, resolveHost);
    if (visited.has(url.href)) throw new NetworkSafetyError('Ciclo de redirecionamento bloqueado por segurança.', 'redirect');
    visited.add(url.href);
    const response = await fetchFn(url.href, { ...options, redirect: 'manual' });
    if (response.type === 'opaqueredirect') {
      throw new NetworkSafetyError('Redirecionamento não verificável bloqueado por segurança.', 'opaque-redirect');
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new NetworkSafetyError('Redirecionamento sem destino verificável bloqueado por segurança.', 'redirect');
      if (hop === 5) throw new NetworkSafetyError('Limite de redirecionamentos excedido; requisição bloqueada por segurança.', 'redirect');
      try { current = new URL(location, url).href; } catch {
        throw new NetworkSafetyError('Destino de redirecionamento inválido; requisição bloqueada por segurança.', 'redirect');
      }
      continue;
    }
    return { response, finalUrl: url.href, redirected: hop > 0 };
  }
  throw new NetworkSafetyError('Limite de redirecionamentos excedido; requisição bloqueada por segurança.', 'redirect');
}
