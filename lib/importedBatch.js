const BATCH_KEY_PREFIX = 'mv_import_batch:';
const BATCH_ID_PATTERN = /^[\da-f-]{36}$/i;
const BATCH_INDEX_KEY = 'mv_import_batch_index';
const BATCH_LOCK_NAME = 'morto-vivo-imported-batches';
export const IMPORTED_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

export class ImportedBatchExpiredError extends Error {
  constructor() {
    super('A lista importada expirou após 24 horas.');
    this.name = 'ImportedBatchExpiredError';
  }
}

function withBatchLock(callback) {
  return navigator.locks.request(BATCH_LOCK_NAME, callback);
}

async function readBatchIndex() {
  const stored = (await chrome.storage.local.get(BATCH_INDEX_KEY))[BATCH_INDEX_KEY];
  return Array.isArray(stored) ? stored : [];
}

async function pruneExpiredBatches(now = Date.now()) {
  const index = await readBatchIndex();
  const valid = index.filter((batch) => batch && BATCH_ID_PATTERN.test(batch.id || '')
    && Number.isFinite(batch.createdAt));
  const active = valid.filter((batch) => now - batch.createdAt < IMPORTED_BATCH_TTL_MS);
  const expired = valid.filter((batch) => now - batch.createdAt >= IMPORTED_BATCH_TTL_MS);
  if (expired.length) {
    await chrome.storage.local.remove(expired.map(({ id }) => `${BATCH_KEY_PREFIX}${id}`));
  }
  if (active.length !== index.length) {
    await chrome.storage.local.set({ [BATCH_INDEX_KEY]: active });
  }
}

export async function saveImportedBatch(urls) {
  return withBatchLock(async () => {
    await pruneExpiredBatches();
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const index = await readBatchIndex();
    await chrome.storage.local.set({
      [`${BATCH_KEY_PREFIX}${id}`]: { urls, createdAt },
      [BATCH_INDEX_KEY]: [...index, { id, createdAt }],
    });
    return id;
  });
}

export async function consumeImportedBatch(id) {
  if (!BATCH_ID_PATTERN.test(id || '')) return null;
  return withBatchLock(async () => {
    const key = `${BATCH_KEY_PREFIX}${id}`;
    const stored = await chrome.storage.local.get(key);
    const batch = stored[key];
    if (batch && !Array.isArray(batch) && Array.isArray(batch.urls)
        && Date.now() - batch.createdAt >= IMPORTED_BATCH_TTL_MS) {
      await discardImportedBatchLocked(id);
      throw new ImportedBatchExpiredError();
    }
    await pruneExpiredBatches();
    if (Array.isArray(batch)) {
      const createdAt = Date.now();
      const index = await readBatchIndex();
      await chrome.storage.local.set({
        [key]: { urls: batch, createdAt },
        [BATCH_INDEX_KEY]: [...index, { id, createdAt }],
      });
      return batch.map(String).filter(Boolean);
    }
    if (!batch || !Array.isArray(batch.urls)) return null;
    return batch.urls.map(String).filter(Boolean);
  });
}

async function discardImportedBatchLocked(id) {
  const index = await readBatchIndex();
  await chrome.storage.local.remove(`${BATCH_KEY_PREFIX}${id}`);
  await chrome.storage.local.set({
    [BATCH_INDEX_KEY]: index.filter((batch) => batch.id !== id),
  });
}

export async function discardImportedBatch(id) {
  if (!BATCH_ID_PATTERN.test(id || '')) return;
  return withBatchLock(() => discardImportedBatchLocked(id));
}
