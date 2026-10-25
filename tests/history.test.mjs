import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearHistory, loadHistory, loadSettings, saveHistory, saveSettings,
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
    await assert.rejects(loadSettings(), failure);
    await assert.rejects(saveHistory({}), failure);
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
      tabMode: false, completionNotification: false,
    });
  });
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
      tabMode: true, completionNotification: true,
    });
    await saveSettings(await loadSettings());
    assert.deepEqual(storedSettings, {
      tabMode: true, completionNotification: true,
    });
  });
});
