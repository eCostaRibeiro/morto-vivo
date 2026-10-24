import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPublicHttpUrl, fetchPublicResource, isPublicIpAddress, NetworkSafetyError,
} from '../lib/networkSafety.js';

test('allows public IPs and rejects private, loopback, and reserved addresses', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isPublicIpAddress(ip), true, ip);
  }
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.1.2', '2001:db8::1', '::1']) {
    assert.equal(isPublicIpAddress(ip), false, ip);
  }
});

test('requires a DNS result containing only public addresses', async () => {
  await assert.rejects(
    assertPublicHttpUrl('https://example.com/', async () => ({
      hasAddress: true,
      addresses: ['93.184.216.34', '10.0.0.1'],
    })),
    NetworkSafetyError,
  );
  await assert.rejects(assertPublicHttpUrl('https://example.com/'), NetworkSafetyError);
});

test('validates each redirect before making the next request', async () => {
  let requests = 0;
  await assert.rejects(fetchPublicResource('https://example.com/', {}, {
    resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => {
      requests++;
      return {
        status: 302,
        type: 'basic',
        headers: new Headers({ location: 'http://127.0.0.1/admin' }),
      };
    },
  }), NetworkSafetyError);
  assert.equal(requests, 1);
});

test('identifies opaque redirects separately from blocked destinations', async () => {
  await assert.rejects(fetchPublicResource('https://instagram.com/example', {}, {
    resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
  }), (error) => error instanceof NetworkSafetyError && error.kind === 'opaque-redirect');
});
