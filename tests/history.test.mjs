import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearHistory, loadHistory, loadManualClassifications, loadSettings, saveHistory,
  saveManualClassifications, saveSettings, applyHistory,
} from '../lib/history.js';

async function withChromeStorage(methods, run) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: methods } };
  try {
    await run();
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
}

test('storage operations propagate Chrome Storage failures', async () => {
  const failure = new Error('storage unavailable');
  await withChromeStorage({
    get: async () => { throw failure; },
    set: async () => { throw failure; },
    remove: async () => { throw failure; },
  }, async () => {
    await assert.rejects(loadHistory(), failure);
    await assert.rejects(loadManualClassifications(), failure);
    await assert.rejects(loadSettings(), failure);
    await assert.rejects(saveHistory({}), failure);
    await assert.rejects(saveManualClassifications({}), failure);
    await assert.rejects(saveSettings({}), failure);
    await assert.rejects(clearHistory(), failure);
  });
});

test('missing stored values still use empty history and default settings', async () => {
  await withChromeStorage({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
  }, async () => {
    assert.deepEqual(await loadHistory(), {});
    assert.deepEqual(await loadSettings(), {
      tabMode: false, completionNotification: false, customRules: [],
    });
  });
});

test('loads and persists only supported manual classifications', async () => {
  let stored = {
    'https://alive.example/': 'vivo',
    'https://dead.example/': 'morto',
    'https://invalid.example/': 'unknown',
    '': 'zumbi',
  };
  await withChromeStorage({
    get: async () => ({ mv_manual_classifications: stored }),
    set: async (values) => { stored = values.mv_manual_classifications; },
    remove: async () => {},
  }, async () => {
    assert.deepEqual(await loadManualClassifications(), {
      'https://alive.example/': 'vivo',
      'https://dead.example/': 'morto',
    });
    await saveManualClassifications({
      'https://alive.example/': 'indeterminado',
      'https://invalid.example/': 'other',
    });
    assert.deepEqual(stored, { 'https://alive.example/': 'indeterminado' });
  });
});

test('keeps manual presentation overrides out of automatic status history', () => {
  const history = {};
  const result = {
    url: 'https://example.com/',
    status: 'vivo',
    reason: 'Classificação manual: Vivo',
    automaticStatus: 'indeterminado',
    automaticReason: 'Sem resposta (timeout)',
    checkedAt: '2026-10-25T00:00:00.000Z',
  };
  applyHistory(history, result);
  assert.equal(history[result.url].last.status, 'indeterminado');
  assert.equal(history[result.url].last.reason, 'Sem resposta (timeout)');
  assert.equal(result.changed, false);
});

test('ignores and removes legacy settings', async () => {
  let storedSettings = {
    tabMode: true,
    completionNotification: true,
    screenshots: true,
    safeShots: false,
    brands: 'Legacy=legacy.example',
  };
  await withChromeStorage({
    get: async () => ({ mv_settings: storedSettings }),
    set: async (values) => { storedSettings = values.mv_settings; },
    remove: async () => {},
  }, async () => {
    assert.deepEqual(await loadSettings(), {
      tabMode: true, completionNotification: true, customRules: [],
    });
    await saveSettings(await loadSettings());
    assert.deepEqual(storedSettings, {
      tabMode: true, completionNotification: true, customRules: [],
    });
  });
});

test('persists only valid custom classification rules', async () => {
  let storedSettings;
  await withChromeStorage({
    get: async () => ({ mv_settings: storedSettings }),
    set: async (values) => { storedSettings = values.mv_settings; },
    remove: async () => {},
  }, async () => {
    await saveSettings({
      tabMode: false,
      completionNotification: false,
      customRules: [
        { status: 'morto', term: ' anúncio removido ' },
        { status: 'unknown', term: 'invalid' },
        { status: 'vivo', term: '' },
      ],
    });
    assert.deepEqual(await loadSettings(), {
      tabMode: false,
      completionNotification: false,
      customRules: [{ status: 'morto', term: 'anúncio removido' }],
    });
  });
});
