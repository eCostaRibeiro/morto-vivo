import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReport, toCsv, toJson } from '../lib/exports.js';

const sample = {
  url: 'https://example.com/item',
  status: 'vivo',
  reason: '=HYPERLINK("https://bad.example","click")',
  httpStatus: 200,
  finalUrl: 'https://example.com/item',
  platformName: null,
  kind: 'site',
  title: '<img src=x onerror=alert(1)>',
  tags: [],
  previous: null,
  changed: false,
  checkedAt: '2026-10-21T00:00:00.000Z',
  via: 'fetch',
  sha256: 'abc123',
  faviconData: '',
  screenshot: { dataUrl: 'data:image/jpeg;base64,AAAA', capturedAt: '2026-10-21T00:00:00.000Z', jsOff: true, sha256: 'shot123' },
};

test('CSV escapes fields and neutralizes spreadsheet formulas', () => {
  const csv = toCsv([sample]);
  assert.match(csv, /^\uFEFF/);
  const [header, row] = csv.slice(1).split('\r\n');
  assert.doesNotMatch(header, /marcas/);
  assert.equal(header.split(';').length, row.split(';').length);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/bad\.example"",""click""\)"/);
  assert.match(csv, /"<img src=x onerror=alert\(1\)>"/);
});

test('HTML report escapes untrusted text and omits legacy screenshot evidence', () => {
  const report = buildReport([sample], '2026-10-21T00:00:00.000Z');
  assert.doesNotMatch(report, /<img src=x onerror=alert\(1\)>/);
  assert.match(report, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(report, /Marca\(s\) possivelmente envolvida\(s\)/);
  assert.doesNotMatch(report, /data:image\/jpeg;base64,AAAA/);
});

test('JSON export omits embedded favicons and legacy screenshots', () => {
  const json = JSON.parse(toJson([sample]))[0];
  assert.equal('faviconData' in json, false);
  assert.equal('screenshot' in json, false);
});
