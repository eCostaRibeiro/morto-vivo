import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defang, normalizeUrl, refang, registrableDomain, safeUrl,
} from '../lib/normalize.js';

test('refang converts common defanged URL indicators', () => {
  assert.equal(refang(' hxxps://example[.]com/path '), 'https://example.com/path');
  assert.equal(refang('hxxp[:]//example(dot)org'), 'http://example.org');
});

test('normalizeUrl adds HTTPS and canonicalizes valid URLs', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('hxxps://example[.]com/path'), 'https://example.com/path');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
});

test('normalizeUrl rejects unsupported schemes and hostnames without a dot', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('localhost'), null);
});

test('normalizeUrl rejects embedded whitespace instead of changing the destination', () => {
  assert.equal(normalizeUrl('example .com'), null);
  assert.equal(normalizeUrl('https://example.com/a path'), null);
  assert.equal(normalizeUrl('https://example.com/a%20path'), 'https://example.com/a%20path');
});

test('normalizeUrl rejects URLs containing credentials', () => {
  assert.equal(normalizeUrl('https://alice:secret@example.com/path'), null);
  assert.equal(normalizeUrl('https://alice@example.com/path'), null);
});

test('defang keeps URL components while making the host non-clickable', () => {
  assert.equal(defang('https://sub.example.com:8443/a?q=1#top'), 'hxxps://sub[.]example[.]com:8443/a?q=1#top');
});

test('registrableDomain handles multi-label suffixes and IP addresses', () => {
  assert.equal(registrableDomain('login.example.com.br'), 'example.com.br');
  assert.equal(registrableDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('192.0.2.1'), '192.0.2.1');
});

test('safeUrl returns null for invalid input', () => {
  assert.equal(safeUrl('not a URL'), null);
  assert.equal(safeUrl('https://example.com').hostname, 'example.com');
});
