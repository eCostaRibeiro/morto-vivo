import assert from 'node:assert/strict';
import test from 'node:test';

import { collectUrlsFromTab, extractUrlsFromText } from '../lib/pageUrlImport.js';

async function withChromeScripting(executeScript, run, tabUrl = 'https://intel.example/') {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = {
    scripting: { executeScript },
    tabs: { get: async () => ({ url: typeof tabUrl === 'function' ? tabUrl() : tabUrl }) },
  };
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

test('does not execute page scripts or read content from ClickUp tabs', async () => {
  let scriptCalls = 0;
  await withChromeScripting(async () => {
    scriptCalls++;
    return [{ result: {} }];
  }, async () => {
    await assert.rejects(
      collectUrlsFromTab(12),
      /ClickUp bloqueada por política local; nenhum conteúdo foi lido/,
    );
    assert.equal(scriptCalls, 0);
  }, 'https://app.clickup.com/t/abc123');
});

test('stops importing if the active tab navigates to ClickUp between page reads', async () => {
  let currentUrl = 'https://intel.example/';
  let scriptCalls = 0;
  await withChromeScripting(async () => {
    scriptCalls++;
    currentUrl = 'https://app.clickup.com/t/abc123';
    return [{
      result: { text: 'vivo.com', fingerprint: 'page-1', origin: 'https://intel.example' },
    }];
  }, async () => {
    const result = await collectUrlsFromTab(12);
    assert.deepEqual(result, {
      urls: ['https://vivo.com'],
      pages: 1,
      complete: false,
      reason: 'Leitura de páginas do ClickUp bloqueada por política local; nenhum conteúdo foi lido.',
    });
    assert.equal(scriptCalls, 1);
  }, () => currentUrl);
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
