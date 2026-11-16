import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORIES, PAUSED_CATEGORY, resultsForCategory, summarizeResults,
} from '../lib/resultsView.js';

test('groups paused TikTok URLs separately, including manually classified skipped results', () => {
  const results = [
    { status: 'vivo', tags: [] },
    { status: 'indeterminado', tags: ['anti-bot'] },
    { status: 'indeterminado', tags: ['queue-paused'] },
    {
      status: 'vivo',
      automaticStatus: 'indeterminado',
      manualClassification: 'vivo',
      tags: ['manual', 'queue-paused'],
    },
  ];

  assert.equal(resultsForCategory(results, CATEGORIES[0]).length, 1);
  assert.equal(resultsForCategory(results, CATEGORIES[3]).length, 1);
  assert.equal(resultsForCategory(results, PAUSED_CATEGORY).length, 2);
  assert.deepEqual(summarizeResults(results), {
    automatic: { vivo: 1, zumbi: 0, morto: 0, indeterminado: 1 },
    manual: { vivo: 1, zumbi: 0, morto: 0, indeterminado: 0 },
    displayed: { vivo: 1, zumbi: 0, morto: 0, indeterminado: 1 },
    manualCount: 1,
    pausedCount: 2,
  });
});
