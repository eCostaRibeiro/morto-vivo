import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyManualClassification,
  clearManualClassification,
  hasEffectiveTakedown,
} from '../lib/manualClassification.js';

test('applies one manual status to a selected batch without losing automatic evidence', () => {
  const results = [
    { url: 'https://one.example/', status: 'indeterminado', reason: 'Timeout', tags: ['timeout'] },
    { url: 'https://two.example/', status: 'zumbi', reason: 'HTTP 503', tags: [] },
  ];

  results.forEach((result) => applyManualClassification(result, 'vivo'));

  assert.deepEqual(results.map(({ status }) => status), ['vivo', 'vivo']);
  assert.deepEqual(results.map(({ manualClassification }) => manualClassification), ['vivo', 'vivo']);
  assert.deepEqual(results.map(({ automaticStatus }) => automaticStatus), ['indeterminado', 'zumbi']);
  assert.deepEqual(results.map(({ automaticReason }) => automaticReason), ['Timeout', 'HTTP 503']);
  assert.ok(results[0].tags.includes('timeout'));
  assert.ok(results.every(({ tags }) => tags.includes('manual')));
  assert.ok(results.every(({ tags }) => !tags.includes('takedown')));
});

test('changing or clearing a manual status preserves and restores the automatic result', () => {
  const result = { status: 'indeterminado', reason: 'Bloqueio DNS', tags: ['seguranca'] };

  applyManualClassification(result, 'morto');
  applyManualClassification(result, 'zumbi');
  assert.equal(result.status, 'zumbi');
  assert.equal(result.automaticStatus, 'indeterminado');
  assert.equal(result.automaticReason, 'Bloqueio DNS');

  clearManualClassification(result);
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.reason, 'Bloqueio DNS');
  assert.equal(result.manualClassification, undefined);
  assert.ok(!result.tags.includes('manual'));
  assert.ok(result.tags.includes('seguranca'));
});

test('rejects unsupported manual statuses', () => {
  assert.throws(
    () => applyManualClassification({ status: 'vivo', reason: 'ok' }, 'unknown'),
    /Status manual inválido/,
  );
});

test('only reports automatic takedown evidence when the manual status does not contradict it', () => {
  const result = {
    status: 'morto',
    reason: 'Site suspenso',
    tags: ['takedown'],
  };

  assert.equal(hasEffectiveTakedown(result), true);
  applyManualClassification(result, 'vivo');
  assert.equal(hasEffectiveTakedown(result), false);
  applyManualClassification(result, 'morto');
  assert.equal(hasEffectiveTakedown(result), true);
  clearManualClassification(result);
  assert.equal(hasEffectiveTakedown(result), true);
});
