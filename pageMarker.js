(() => {
  const instanceKey = '__mortoVivoPageMarker';
  const existing = globalThis[instanceKey];
  if (existing) {
    existing.refresh();
    return;
  }

  const supportedStatuses = new Set(['vivo', 'zumbi', 'morto', 'indeterminado']);
  let statusByUrl = new Map();
  let active = false;
  let observer;
  let refreshRevision = 0;

  function urlKey(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  function removeBadge(link) {
    link.removeAttribute('data-mv-checked-status');
    const badge = link.nextElementSibling;
    if (badge?.hasAttribute('data-mv-history-badge')) badge.remove();
  }

  function updateLink(link) {
    const status = statusByUrl.get(urlKey(link.href))
      || statusByUrl.get(urlKey(link.textContent));
    if (!supportedStatuses.has(status)) {
      removeBadge(link);
      return;
    }

    link.setAttribute('data-mv-checked-status', status);
    let badge = link.nextElementSibling;
    if (!badge?.hasAttribute('data-mv-history-badge')) {
      badge = document.createElement('span');
      badge.setAttribute('data-mv-history-badge', '');
      link.after(badge);
    }
    badge.className = 'mv-history-badge';
    badge.dataset.status = status;
    badge.textContent = status;
    badge.title = `Classificação mais recente no Morto-Vivo: ${status}`;
    badge.setAttribute('aria-label', `Classificação mais recente no Morto-Vivo: ${status}`);
  }

  function scanNode(node) {
    const root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!root) return;
    const parentLink = root.matches?.('a[href]') ? root : root.closest?.('a[href]');
    if (parentLink) updateLink(parentLink);
    root.querySelectorAll?.('a[href]').forEach(updateLink);
  }

  function clearMarkers() {
    document.querySelectorAll('a[data-mv-checked-status]').forEach(removeBadge);
    document.querySelectorAll('[data-mv-history-badge]').forEach((badge) => badge.remove());
  }

  function deactivate() {
    active = false;
    observer?.disconnect();
    observer = null;
    statusByUrl = new Map();
    clearMarkers();
  }

  function activate(history, manualClassifications) {
    const statuses = new Map();
    for (const [url, entry] of Object.entries(history || {})) {
      const status = entry?.last?.status;
      if (supportedStatuses.has(status)) statuses.set(urlKey(url), status);
    }
    for (const [url, status] of Object.entries(manualClassifications || {})) {
      if (supportedStatuses.has(status)) statuses.set(urlKey(url), status);
    }
    statuses.delete(null);
    statusByUrl = statuses;
    active = true;
    document.querySelectorAll('a[href]').forEach(updateLink);
    if (!observer && document.documentElement) {
      observer = new MutationObserver((records) => {
        records.forEach((record) => {
          if (record.type === 'attributes') scanNode(record.target);
          else if (record.type === 'characterData') scanNode(record.target);
          else record.addedNodes.forEach(scanNode);
        });
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href'],
      });
    }
  }

  async function refresh() {
    const revision = ++refreshRevision;
    try {
      const stored = await chrome.storage.local.get([
        'mv_settings', 'mv_history', 'mv_manual_classifications',
      ]);
      if (revision !== refreshRevision) return;
      if (!stored.mv_settings?.markCheckedUrls) {
        deactivate();
        return;
      }
      if (active) clearMarkers();
      activate(stored.mv_history, stored.mv_manual_classifications);
    } catch (error) {
      if (revision === refreshRevision) deactivate();
      console.error('Não foi possível atualizar as marcações do Morto-Vivo nesta página:', error);
    }
  }

  globalThis[instanceKey] = { refresh };
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.mv_settings || changes.mv_history || changes.mv_manual_classifications) refresh();
  });
  refresh();
})();
