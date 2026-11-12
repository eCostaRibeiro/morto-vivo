import assert from 'node:assert/strict';
import test from 'node:test';

import { collectUrlsFromTab, extractUrlsFromText } from '../lib/pageUrlImport.js';

async function withChromeScripting(executeScript, run) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { scripting: { executeScript } };
  try {
    await run();
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
}

test('extracts displayed bare domains and URLs without using link destinations', () => {
  assert.deepEqual(extractUrlsFromText(
    'Domain\nvivo.com\nhttps://vivo.com.br/ofertas?id=10\n',
  ), [
    'https://vivo.com',
    'https://vivo.com.br/ofertas?id=10',
  ]);
});

test('normalizes defanged displayed URLs and removes duplicates', () => {
  assert.deepEqual(extractUrlsFromText(
    'hxxps://site-falso[.]top/login.\nhttps://site-falso.top/login\nexample[.]org',
  ), [
    'https://site-falso.top/login',
    'https://example.org',
  ]);
});

test('does not interpret email addresses or provider labels as URLs', () => {
  assert.deepEqual(extractUrlsFromText(
    'security@example.com\nCloudflare, Inc.\nMicrosoft Corporation\n',
  ), []);
});

test('collects and deduplicates displayed URLs across paginated pages', async () => {
  const scriptResults = [
    { text: 'vivo.com', fingerprint: 'page-1', origin: 'https://intel.example' },
    { fingerprint: 'page-1', origin: 'https://intel.example', clicked: true, hasNext: true },
    { fingerprint: 'page-2', origin: 'https://intel.example' },
    { fingerprint: 'page-2', origin: 'https://intel.example' },
    { text: 'vivo.com\nexample.org/path', fingerprint: 'page-2', origin: 'https://intel.example' },
    {
      fingerprint: 'page-2',
      origin: 'https://intel.example',
      clicked: false,
      hasNext: false,
      hasDisabledNextControl: false,
      paginationDetected: false,
    },
  ];
  await withChromeScripting(async () => [{ result: scriptResults.shift() }], async () => {
    const progress = [];
    const result = await collectUrlsFromTab(12, {
      onProgress: (value) => progress.push(value),
    });

    assert.deepEqual(result, {
      urls: ['https://vivo.com', 'https://example.org/path'],
      pages: 2,
      complete: true,
      reason: '',
    });
    assert.deepEqual(progress, [{ pages: 1, urls: 1 }, { pages: 2, urls: 2 }]);
  });
});

test('reports incomplete collection when pagination exists but no next control is recognized', async () => {
  const scriptResults = [
    { text: 'vivo.com', fingerprint: 'page-1', origin: 'https://intel.example' },
    {
      fingerprint: 'page-1',
      origin: 'https://intel.example',
      clicked: false,
      hasNext: false,
      hasDisabledNextControl: false,
      paginationDetected: true,
    },
  ];
  await withChromeScripting(async () => [{ result: scriptResults.shift() }], async () => {
    const result = await collectUrlsFromTab(12);

    assert.equal(result.complete, false);
    assert.match(result.reason, /não foi possível identificar uma próxima página/i);
    assert.deepEqual(result.urls, ['https://vivo.com']);
  });
});
