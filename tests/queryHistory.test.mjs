import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addQueryHistory, clearQueryHistory, loadQueryHistory, MAX_QUERY_HISTORY, setQueryFavorite,
} from '../lib/queryHistory.js';

async function withChromeStorage(methods, run) {
  const originalChrome = globalThis.chrome;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.chrome = { storage: { local: methods } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request: (_name, callback) => callback() } },
  });
  try {
    await run();
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
}

test('stores the latest 100 URL analyses and their result summaries', async () => {
  let stored;
  await withChromeStorage({
    get: async () => ({ mv_query_history: stored }),
    set: async (values) => { stored = values.mv_query_history; },
    remove: async () => { stored = undefined; },
  }, async () => {
    for (let index = 0; index < MAX_QUERY_HISTORY + 2; index++) {
      await addQueryHistory([`https://example${index}.com/`], { vivo: index, morto: 1 }, index + 1);
    }
    const history = await loadQueryHistory();
    assert.equal(history.entries.length, MAX_QUERY_HISTORY);
    assert.equal(history.entries[0].urls[0], 'https://example101.com/');
    assert.equal(history.entries.at(-1).urls[0], 'https://example2.com/');
    assert.equal(history.entries[0].summary.vivo, 101);
    assert.equal(history.entries[0].summary.morto, 1);
    assert.equal(history.entries[0].summary.zumbi, 0);
    assert.deepEqual(history.favorites, []);
  });
});

test('ignores malformed history entries and propagates storage failures', async () => {
  await withChromeStorage({
    get: async () => ({
      mv_query_history: {
        entries: [
          { id: 'valid', createdAt: 1, urls: ['https://example.com/'] },
          { id: 'invalid-date', createdAt: 'invalid', urls: ['https://invalid.example/'] },
          { id: 'empty', createdAt: 2, urls: [] },
        ],
        favorites: [],
      },
    }),
    set: async () => { throw new Error('storage unavailable'); },
    remove: async () => { throw new Error('storage unavailable'); },
  }, async () => {
    const history = await loadQueryHistory();
    assert.equal(history.entries.length, 1);
    assert.deepEqual(history.entries[0].summary, {
      vivo: 0, zumbi: 0, morto: 0, indeterminado: 0,
    });
    await assert.rejects(addQueryHistory(['https://example.com/']), /storage unavailable/);
    await assert.rejects(setQueryFavorite(history.entries[0].id, true), /storage unavailable/);
    await assert.rejects(clearQueryHistory(), /storage unavailable/);
  });
});

test('clears only the saved query history', async () => {
  const stored = {
    mv_query_history: [{ createdAt: 1, urls: ['https://example.com/'] }],
    mv_history: { 'https://example.com/': { last: { status: 'vivo' } } },
  };
  await withChromeStorage({
    get: async (key) => ({ [key]: stored[key] }),
    set: async (values) => { Object.assign(stored, values); },
    remove: async (key) => { assert.equal(key, 'mv_query_history'); delete stored[key]; },
  }, async () => {
    await clearQueryHistory();
    assert.deepEqual(await loadQueryHistory(), { entries: [], favorites: [] });
    assert.deepEqual(stored.mv_history, { 'https://example.com/': { last: { status: 'vivo' } } });
  });
});

test('keeps favorites separate from the latest 100 and supports removing a favorite', async () => {
  let stored;
  await withChromeStorage({
    get: async () => ({ mv_query_history: stored }),
    set: async (values) => { stored = values.mv_query_history; },
    remove: async () => { stored = undefined; },
  }, async () => {
    await addQueryHistory(['https://favorite.example/'], {}, 1);
    let history = await loadQueryHistory();
    const favoriteId = history.entries[0].id;
    await setQueryFavorite(favoriteId, true);
    for (let index = 0; index < MAX_QUERY_HISTORY; index++) {
      await addQueryHistory([`https://recent${index}.example/`], {}, index + 2);
    }

    history = await loadQueryHistory();
    assert.equal(history.entries.length, MAX_QUERY_HISTORY);
    assert.equal(history.favorites.length, 1);
    assert.equal(history.favorites[0].id, favoriteId);
    assert.equal(history.favorites[0].urls[0], 'https://favorite.example/');

    const updated = await setQueryFavorite(favoriteId, false);
    assert.deepEqual(updated.favorites, []);
  });
});

test('migrates existing query history entries with stable favorite IDs', async () => {
  let stored = [{ createdAt: 123, urls: ['https://legacy.example/'], summary: { vivo: 1 } }];
  await withChromeStorage({
    get: async () => ({ mv_query_history: stored }),
    set: async (values) => { stored = values.mv_query_history; },
    remove: async () => { stored = undefined; },
  }, async () => {
    const history = await loadQueryHistory();
    assert.equal(typeof history.entries[0].id, 'string');
    assert.equal(stored.entries[0].id, history.entries[0].id);
    await setQueryFavorite(history.entries[0].id, true);
    assert.equal((await loadQueryHistory()).favorites[0].urls[0], 'https://legacy.example/');
  });
});
