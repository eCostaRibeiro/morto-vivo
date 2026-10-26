import assert from 'node:assert/strict';
import test from 'node:test';

import { makeDoh } from '../lib/dns.js';

test('resolves host successfully via primary provider (Cloudflare)', async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes('cloudflare-dns.com') && url.includes('type=AAAA')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 28, data: '2606:2800:220:1:248:1893:25c8:1946' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('cloudflare-dns.com') && url.includes('type=A')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '93.184.216.34' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected call: ${url}`);
  };

  const resolve = makeDoh(mockFetch);
  const result = await resolve('example.com');

  assert.equal(result.rcode, 0);
  assert.equal(result.hasAddress, true);
  assert.equal(result.nxdomain, false);
  assert.equal(result.servfail, false);
  assert.equal(result.sinkhole, false);
  assert.equal(result.provider, 'Cloudflare');
  assert.deepEqual(result.addresses, [
    '93.184.216.34',
    '2606:2800:220:1:248:1893:25c8:1946',
  ]);
  assert.equal(calls.some((u) => u.includes('dns.google')), false);
});

test('falls back transparently to Google Public DNS when Cloudflare fails', async () => {
  const calls = [];
  const mockFetch = async (url) => {
    calls.push(url);
    if (url.includes('cloudflare-dns.com')) {
      // Simula bloqueio de rede corporativa / falha no Cloudflare
      throw new TypeError('Failed to fetch (network error / blocked)');
    }
    if (url.includes('dns.google') && url.includes('type=AAAA')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('dns.google') && url.includes('type=A')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '104.244.42.1' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected call: ${url}`);
  };

  const resolve = makeDoh(mockFetch);
  const result = await resolve('x.com');

  assert.equal(result.rcode, 0);
  assert.equal(result.hasAddress, true);
  assert.equal(result.nxdomain, false);
  assert.equal(result.provider, 'Google');
  assert.deepEqual(result.addresses, ['104.244.42.1']);
  assert.equal(calls.some((u) => u.includes('cloudflare-dns.com')), true);
  assert.equal(calls.some((u) => u.includes('dns.google')), true);
});

test('handles NXDOMAIN response correctly from fallback provider', async () => {
  const mockFetch = async (url) => {
    if (url.includes('cloudflare-dns.com')) {
      return new Response('Blocked', { status: 403 });
    }
    if (url.includes('dns.google')) {
      return new Response(JSON.stringify({
        Status: 3, // NXDOMAIN
        Answer: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error('Unexpected URL');
  };

  const resolve = makeDoh(mockFetch);
  const result = await resolve('nonexistent-domain-123456789.com');

  assert.equal(result.rcode, 3);
  assert.equal(result.nxdomain, true);
  assert.equal(result.hasAddress, false);
  assert.equal(result.provider, 'Google');
});

test('throws when all DoH endpoints fail', async () => {
  const mockFetch = async () => {
    throw new TypeError('Network connection refused');
  };

  const resolve = makeDoh(mockFetch);
  await assert.rejects(
    () => resolve('example.com'),
    /Network connection refused|Falha na consulta/,
  );
});

test('resolves IPv4 literal without calling any DoH endpoint', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    throw new Error('Should not call fetch for IP literal');
  };

  const resolve = makeDoh(mockFetch);
  const publicResult = await resolve('93.184.216.34');
  assert.equal(publicResult.rcode, 0);
  assert.equal(publicResult.hasAddress, true);
  assert.equal(publicResult.sinkhole, false);
  assert.equal(publicResult.provider, 'literal');
  assert.deepEqual(publicResult.addresses, ['93.184.216.34']);
  assert.equal(called, false);

  const privateResult = await resolve('127.0.0.1');
  assert.equal(privateResult.sinkhole, true);
});

test('deduplicates concurrent resolution via in-memory cache', async () => {
  let queries = 0;
  const mockFetch = async (url) => {
    queries++;
    return new Response(JSON.stringify({
      Status: 0,
      Answer: [{ type: url.includes('type=A') ? 1 : 28, data: '93.184.216.34' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const resolve = makeDoh(mockFetch);
  const [res1, res2] = await Promise.all([
    resolve('example.com'),
    resolve('example.com'),
  ]);

  assert.deepEqual(res1, res2);
  // Apenas 1 consulta para A e 1 para AAAA foram feitas (2 requisições no total)
  assert.equal(queries, 2);
});
