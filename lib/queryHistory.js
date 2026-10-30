const QUERY_HISTORY_KEY = 'mv_query_history';
export const MAX_QUERY_HISTORY = 100;
const QUERY_HISTORY_LOCK_NAME = 'morto-vivo-query-history';
const STATUS_KEYS = ['vivo', 'zumbi', 'morto', 'indeterminado'];

function withQueryHistoryLock(callback) {
  return navigator.locks.request(QUERY_HISTORY_LOCK_NAME, callback);
}

function normalizeSummary(summary) {
  return Object.fromEntries(STATUS_KEYS.map((status) => [
    status,
    Number.isSafeInteger(summary?.[status]) && summary[status] >= 0 ? summary[status] : 0,
  ]));
}

function normalizeEntry(entry) {
  if (!entry || !Number.isFinite(entry.createdAt) || Math.abs(entry.createdAt) > 8.64e15
      || !Array.isArray(entry.urls)) return null;
  const urls = entry.urls.filter((url) => typeof url === 'string' && url.length > 0);
  if (!urls.length) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    createdAt: entry.createdAt,
    urls,
    summary: normalizeSummary(entry.summary),
  };
}

async function readStore() {
  const stored = (await chrome.storage.local.get(QUERY_HISTORY_KEY))[QUERY_HISTORY_KEY];
  const rawEntries = Array.isArray(stored) ? stored : stored?.entries;
  const rawFavorites = Array.isArray(stored?.favorites) ? stored.favorites : [];
  const entries = Array.isArray(rawEntries) ? rawEntries.map(normalizeEntry).filter(Boolean) : [];
  const favorites = rawFavorites.map(normalizeEntry).filter(Boolean);
  return {
    entries: entries.slice(0, MAX_QUERY_HISTORY),
    favorites,
    needsMigration: Array.isArray(stored)
      || (stored && typeof stored === 'object'
        && [...(Array.isArray(rawEntries) ? rawEntries : []), ...rawFavorites]
          .some((entry) => entry && typeof entry === 'object' && !entry.id)),
  };
}

export async function loadQueryHistory() {
  return withQueryHistoryLock(async () => {
    const store = await readStore();
    if (store.needsMigration) {
      await chrome.storage.local.set({
        [QUERY_HISTORY_KEY]: { entries: store.entries, favorites: store.favorites },
      });
    }
    delete store.needsMigration;
    return store;
  });
}

export async function addQueryHistory(urls, summary = {}, createdAt = Date.now()) {
  return withQueryHistoryLock(async () => {
    const entry = normalizeEntry({
      createdAt,
      urls,
      summary,
    });
    if (!entry) throw new TypeError('O histórico exige ao menos uma URL válida.');
    const store = await readStore();
    store.entries = [entry, ...store.entries].slice(0, MAX_QUERY_HISTORY);
    await chrome.storage.local.set({
      [QUERY_HISTORY_KEY]: { entries: store.entries, favorites: store.favorites },
    });
    return entry;
  });
}

export async function setQueryFavorite(id, favorite) {
  return withQueryHistoryLock(async () => {
    const store = await readStore();
    const favoriteIndex = store.favorites.findIndex((entry) => entry.id === id);
    if (favorite) {
      if (favoriteIndex === -1) {
        const entry = store.entries.find((candidate) => candidate.id === id);
        if (!entry) throw new Error('A análise não está mais disponível no histórico.');
        store.favorites.unshift(entry);
      }
    } else if (favoriteIndex !== -1) {
      store.favorites.splice(favoriteIndex, 1);
    }
    await chrome.storage.local.set({
      [QUERY_HISTORY_KEY]: { entries: store.entries, favorites: store.favorites },
    });
    return { entries: store.entries, favorites: store.favorites };
  });
}

export async function clearQueryHistory() {
  return withQueryHistoryLock(() => chrome.storage.local.remove(QUERY_HISTORY_KEY));
}
