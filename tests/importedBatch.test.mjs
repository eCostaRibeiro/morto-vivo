import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeImportedBatch, discardImportedBatch, IMPORTED_BATCH_TTL_MS,
  ImportedBatchExpiredError, saveImportedBatch,
} from '../lib/importedBatch.js';

async function withChromeStorage(methods, run) {
  const originalChrome = globalThis.chrome;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let lockQueue = Promise.resolve();
  globalThis.chrome = { storage: { local: methods } };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name, callback) => {
          const task = lockQueue.then(callback);
          lockQueue = task.catch(() => {});
          return task;
        },
      },
    },
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

test('keeps imported URL batches available for results-page refresh', async () => {
  const stored = {};
  await withChromeStorage({
    set: async (values) => Object.assign(stored, values),
    get: async (key) => Object.hasOwn(stored, key) ? { [key]: stored[key] } : {},
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    },
  }, async () => {
    const id = await saveImportedBatch(['https://example.com/']);
    assert.match(id, /^[\da-f-]{36}$/i);
    assert.deepEqual(await consumeImportedBatch(id), ['https://example.com/']);
    assert.deepEqual(await consumeImportedBatch(id), ['https://example.com/']);
    await discardImportedBatch(id);
    assert.equal(await consumeImportedBatch(id), null);
  });
});

test('rejects invalid imported batch identifiers and can discard unused batches', async () => {
  const stored = {};
  await withChromeStorage({
    set: async (values) => Object.assign(stored, values),
    get: async (key) => Object.hasOwn(stored, key) ? { [key]: stored[key] } : {},
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    },
  }, async () => {
    assert.equal(await consumeImportedBatch('../invalid'), null);
    const id = await saveImportedBatch(['https://example.com/']);
    await discardImportedBatch(id);
    assert.equal(await consumeImportedBatch(id), null);
  });
});

test('removes imported batches after their refresh window expires', async () => {
  const stored = {};
  await withChromeStorage({
    set: async (values) => Object.assign(stored, values),
    get: async (key) => Object.hasOwn(stored, key) ? { [key]: stored[key] } : {},
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    },
  }, async () => {
    const id = await saveImportedBatch(['https://example.com/']);
    const createdAt = Date.now() - IMPORTED_BATCH_TTL_MS - 1;
    stored[`mv_import_batch:${id}`].createdAt = createdAt;
    stored.mv_import_batch_index[0].createdAt = createdAt;

    await assert.rejects(consumeImportedBatch(id), ImportedBatchExpiredError);
    assert.equal(Object.hasOwn(stored, `mv_import_batch:${id}`), false);
    assert.deepEqual(stored.mv_import_batch_index, []);
  });
});

test('serializes concurrent saves so the batch index retains every import', async () => {
  const stored = {};
  await withChromeStorage({
    set: async (values) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      Object.assign(stored, values);
    },
    get: async (key) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return Object.hasOwn(stored, key) ? { [key]: stored[key] } : {};
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
    },
  }, async () => {
    const ids = await Promise.all([
      saveImportedBatch(['https://one.example/']),
      saveImportedBatch(['https://two.example/']),
      saveImportedBatch(['https://three.example/']),
    ]);
    assert.equal(new Set(ids).size, 3);
    assert.deepEqual(
      stored.mv_import_batch_index.map(({ id }) => id).sort(),
      [...ids].sort(),
    );
  });
});
