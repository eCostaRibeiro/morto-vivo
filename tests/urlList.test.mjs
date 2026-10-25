import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_IMPORTED_URLS, MAX_IMPORT_FILE_BYTES, parseUrlList,
} from '../lib/urlList.js';

test('parses, normalizes, and deduplicates URL list lines', () => {
  assert.deepEqual(parseUrlList(
    '\uFEFFhttps://example.com\nhttps://example.com/\nhxxps://site-falso[.]top/login\nnot a URL\n',
  ), {
    valid: ['https://example.com', 'https://site-falso.top/login'],
    invalid: ['not a URL'],
    duplicates: 1,
  });
});

test('sets practical bounds for imported TXT files', () => {
  assert.equal(MAX_IMPORTED_URLS, 500);
  assert.equal(MAX_IMPORT_FILE_BYTES, 1024 * 1024);
  const parsed = parseUrlList(
    Array(MAX_IMPORTED_URLS + 1).fill('https://example.com').join('\n'),
  );
  assert.equal(parsed.valid.length, 1);
  assert.equal(parsed.duplicates, MAX_IMPORTED_URLS);
});
