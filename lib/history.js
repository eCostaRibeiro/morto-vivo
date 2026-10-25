// Histórico por URL em chrome.storage.local — permite ver "era VIVO, agora MORTO" (takedown confirmado).
// Erros do Chrome Storage são propagados para a interface decidir se deve avisar ou interromper a ação.

const KEY = 'mv_history';
const MAX_ENTRIES = 3000;

/** Carrega o histórico completo local; falhas de storage são propagadas. */
export async function loadHistory() {
  return (await chrome.storage.local.get(KEY))[KEY] || {};
}

/** Atualiza `res` com a comparação anterior e altera `hist` no lugar. */
export function applyHistory(hist, res) {
  const prev = hist[res.url];
  const entry = prev || { first: { status: res.status, at: res.checkedAt }, changes: [] };
  res.previous = prev ? { status: prev.last.status, reason: prev.last.reason, at: prev.last.at } : null;
  res.changed = !!(prev && prev.last.status !== res.status);
  if (res.changed) entry.changes.push({ from: prev.last.status, to: res.status, at: res.checkedAt });
  entry.changes = entry.changes.slice(-20);
  entry.last = { status: res.status, reason: res.reason, at: res.checkedAt };
  hist[res.url] = entry;
}

export async function saveHistory(hist) {
  // Mantém as alterações recentes por URL e limita o histórico total para controlar o uso do storage.
  const keys = Object.keys(hist);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => hist[a].last.at.localeCompare(hist[b].last.at));
    keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete hist[k]);
  }
  await chrome.storage.local.set({ [KEY]: hist });
}

export async function clearHistory() {
  await chrome.storage.local.remove(KEY);
}

export const SETTINGS_KEY = 'mv_settings';
export const DEFAULT_SETTINGS = { tabMode: false, completionNotification: false };

/** Lê preferências e aplica defaults/validação de tipo aos dados persistidos. */
export async function loadSettings() {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  return {
    ...DEFAULT_SETTINGS,
    tabMode: !!stored.tabMode,
    completionNotification: !!stored.completionNotification,
  };
}

/** Persiste apenas as opções reconhecidas; erros de storage são propagados. */
export async function saveSettings(s) {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      tabMode: !!s.tabMode,
      completionNotification: !!s.completionNotification,
    },
  });
}
