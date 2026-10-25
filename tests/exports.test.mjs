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

test('exports manual and automatic classifications separately', () => {
  const manual = {
    ...sample,
    status: 'vivo',
    reason: 'Classificação manual: Vivo',
    automaticStatus: 'indeterminado',
    automaticReason: 'Sem resposta (timeout)',
    manualClassification: 'vivo',
    tags: ['manual'],
  };
  const csv = toCsv([manual]);
  assert.match(csv, /status_automatico/);
  assert.match(csv, /motivo_automatico/);
  assert.match(csv, /classificacao_manual/);
  assert.match(csv, /estacionado/);
  assert.match(csv, /"indeterminado"/);
  assert.match(csv, /"Sem resposta \(timeout\)"/);
  assert.match(csv, /"vivo"/);

  const report = buildReport([manual]);
  assert.match(report, /Classificação manual: vivo · automática: indeterminado/);
  assert.match(report, /Sem resposta \(timeout\)/);
});

test('exports parked-domain evidence separately from takedown', () => {
  const parked = { ...sample, tags: ['parked'] };
  const [header, row] = toCsv([parked]).slice(1).split('\r\n');
  const columns = header.split(';');
  const values = row.split(';').map((value) => value.replace(/^"|"$/g, ''));
  assert.equal(values[columns.indexOf('derrubado')], '');
  assert.equal(values[columns.indexOf('estacionado')], 'sim');
  assert.match(buildReport([parked]), /não é confirmação de takedown/);
  assert.doesNotMatch(buildReport([parked]), /DERRUBADO\/SUSPENSO/);
});

test('JSON export omits embedded favicons and legacy screenshots', () => {
  const json = JSON.parse(toJson([sample]))[0];
  assert.equal('faviconData' in json, false);
  assert.equal('screenshot' in json, false);
});
