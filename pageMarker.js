(() => {
  const instanceKey = '__mortoVivoPageMarker';
  const existing = globalThis[instanceKey];
  try {
    const host = new URL(location.href).hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'clickup.com' || host.endsWith('.clickup.com')) {
      existing?.deactivate?.();
      return;
    }
  } catch {
    return;
  }
  if (existing) {
    existing.refresh();
    return;
  }

  const supportedStatuses = new Set(['vivo', 'zumbi', 'morto', 'indeterminado']);
  const statusBadgeAttribute = 'data-mv-history-badge';
  const duplicateBadgeAttribute = 'data-mv-duplicate-badge';
  const deadScrollTrackAttribute = 'data-mv-dead-scroll-track';
  const deadScrollMarkerAttribute = 'data-mv-dead-scroll-marker';
  const markerSelector = `[${statusBadgeAttribute}], [${duplicateBadgeAttribute}], [${deadScrollTrackAttribute}]`;
  const threatXHost = 'cyber.threatx.com.br';
  let statusByUrl = new Map();
  let threatXSession = null;
  let deadScrollTrack = null;
  let deadScrollContainer = null;
  let deadScrollLinks = [];
  let active = false;
  let observer;
  let scanTimer = null;
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

  function previousBadge(link, attribute) {
    let sibling = link.previousElementSibling;
    while (sibling?.hasAttribute(statusBadgeAttribute)
      || sibling?.hasAttribute(duplicateBadgeAttribute)) {
      if (sibling.hasAttribute(attribute)) return sibling;
      sibling = sibling.previousElementSibling;
    }
    return null;
  }

  function removeBadge(link, badgeAttribute, linkAttribute) {
    link.removeAttribute(linkAttribute);
    previousBadge(link, badgeAttribute)?.remove();
  }

  function getOrCreateBadge(link, attribute) {
    let badge = previousBadge(link, attribute);
    if (!badge) {
      badge = document.createElement('span');
      badge.setAttribute(attribute, '');
      link.before(badge);
    }
    return badge;
  }

  function updateStatusBadge(link, status) {
    if (!supportedStatuses.has(status)) {
      removeBadge(link, statusBadgeAttribute, 'data-mv-checked-status');
      return;
    }

    link.setAttribute('data-mv-checked-status', status);
    const badge = getOrCreateBadge(link, statusBadgeAttribute);
    badge.className = 'mv-history-badge';
    badge.dataset.status = status;
    if (badge.textContent !== status) badge.textContent = status;
    badge.title = `Classificação mais recente no Morto-Vivo: ${status}`;
    badge.setAttribute('aria-label', `Classificação mais recente no Morto-Vivo: ${status}`);
  }

  function updateDuplicateBadge(link, count, appearsOnOtherPage = false) {
    if (count < 2 && !appearsOnOtherPage) {
      removeBadge(link, duplicateBadgeAttribute, 'data-mv-duplicate-count');
      link.removeAttribute('data-mv-duplicate-across-pages');
      return;
    }

    link.setAttribute('data-mv-duplicate-count', String(count));
    if (appearsOnOtherPage) link.setAttribute('data-mv-duplicate-across-pages', 'true');
    else link.removeAttribute('data-mv-duplicate-across-pages');
    const badge = getOrCreateBadge(link, duplicateBadgeAttribute);
    badge.className = 'mv-history-duplicate-badge';
    badge.dataset.count = String(count);
    const label = count > 1 ? `DUPLICADA ×${count}` : 'DUPLICADA';
    if (badge.textContent !== label) badge.textContent = label;
    badge.title = count > 1
      ? `Esta URL aparece ${count} vezes nesta página.${appearsOnOtherPage ? ' Também aparece em outra página desta busca.' : ''}`
      : 'Esta URL também aparece em outra página desta busca.';
    badge.setAttribute('aria-label', count > 1
      ? `URL duplicada: aparece ${count} vezes nesta página${appearsOnOtherPage ? ' e em outra página desta busca' : ''}`
      : 'URL duplicada: também aparece em outra página desta busca');
  }

  function isThreatXHost() {
    try {
      const url = new URL(location.href);
      return url.hostname === threatXHost;
    } catch {
      return false;
    }
  }

  function threatXPageSnapshot() {
    const url = new URL(location.href);
    const rangePattern = /Mostrando\s+([\d.]+)\s+até\s+([\d.]+)\s+de\s+([\d.]+)\s+resultados/i;
    const rangeNode = [...document.querySelectorAll('p')]
      .find((element) => rangePattern.test(element.textContent || ''));
    const range = rangeNode?.textContent?.match(rangePattern);
    if (!range) return null;

    const numberFromText = (value) => Number(String(value).replace(/\D/g, ''));
    const start = numberFromText(range[1]);
    const total = numberFromText(range[3]);
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const pageSize = Number(url.searchParams.get('limit') || numberFromText(range[2]) - start + 1);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1
      || start !== ((pageNumber - 1) * pageSize) + 1) return null;

    let resultContainer = rangeNode.parentElement;
    let resultLinks = [];
    while (resultContainer && resultContainer !== document.body) {
      resultLinks = [...resultContainer.querySelectorAll('a[href]')].filter((link) => {
        try {
          return link.getClientRects().length > 0
            && new URL(link.href).origin !== url.origin
            && Boolean(urlKey(link.href));
        } catch {
          return false;
        }
      });
      if (resultLinks.length) break;
      resultContainer = resultContainer.parentElement;
    }
    if (!resultLinks.length) return null;

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const activeTab = [...document.querySelectorAll('[role="tab"]')]
      .find((element) => element.getAttribute('aria-selected') === 'true');
    const resetFilters = [...document.querySelectorAll('button')]
      .find((button) => normalizeText(button.innerText || button.textContent).toLowerCase() === 'resetar filtros');
    const filters = resetFilters?.parentElement
      ? [...resetFilters.parentElement.querySelectorAll('button')]
        .filter((button) => button !== resetFilters)
        .map((button) => normalizeText(button.innerText || button.textContent))
        .sort()
      : [];
    const searchTerm = [...document.querySelectorAll('input')]
      .find((input) => input.getAttribute('placeholder') === 'Pesquise pela URL de uma ameaça')
      ?.value?.trim() || '';
    const query = [...url.searchParams.entries()]
      .filter(([key]) => key.toLowerCase() !== 'page')
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));

    return {
      listingKey: JSON.stringify({
        origin: url.origin,
        path: url.pathname,
        query,
        total,
        activeTab: normalizeText(activeTab?.innerText || activeTab?.textContent),
        searchTerm,
        filters,
      }),
      pageNumber,
      links: resultLinks,
    };
  }

  function crossPageDuplicateKeys(snapshot) {
    if (!snapshot) return new Set();
    if (!threatXSession || threatXSession.listingKey !== snapshot.listingKey) {
      threatXSession = { listingKey: snapshot.listingKey, pages: new Map() };
    }

    const currentPageUrls = new Set(snapshot.links.map((link) => urlKey(link.href)).filter(Boolean));
    threatXSession.pages.set(snapshot.pageNumber, currentPageUrls);
    const duplicates = new Set();
    for (const [pageNumber, urls] of threatXSession.pages) {
      if (pageNumber === snapshot.pageNumber) continue;
      for (const key of currentPageUrls) {
        if (urls.has(key)) duplicates.add(key);
      }
    }
    return duplicates;
  }

  function findScrollableAncestor(element) {
    for (let ancestor = element.parentElement;
      ancestor && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement) {
      const { overflowY } = getComputedStyle(ancestor);
      if (/(auto|scroll|overlay)/.test(overflowY)
        && ancestor.scrollHeight > ancestor.clientHeight) return ancestor;
    }

    const root = document.scrollingElement || document.documentElement;
    return root.scrollHeight > root.clientHeight ? root : null;
  }

  function updateDeadScrollMarkerPositions() {
    if (!deadScrollTrack || !deadScrollContainer) return;
    const rect = deadScrollContainer.getBoundingClientRect();
    const scrollbarWidth = Math.max(0, deadScrollContainer.offsetWidth - deadScrollContainer.clientWidth);
    const trackWidth = Math.max(8, Math.min(14, scrollbarWidth || 8));
    const scrollbarSpace = Math.max(scrollbarWidth, trackWidth);
    deadScrollTrack.style.left = `${rect.right - scrollbarSpace + ((scrollbarSpace - trackWidth) / 2)}px`;
    deadScrollTrack.style.top = `${rect.top}px`;
    deadScrollTrack.style.width = `${trackWidth}px`;
    deadScrollTrack.style.height = `${deadScrollContainer.clientHeight}px`;

    const scrollRange = Math.max(1, deadScrollContainer.scrollHeight - deadScrollContainer.clientHeight);
    const thumbHeight = deadScrollContainer.clientHeight ** 2 / deadScrollContainer.scrollHeight;
    const markerRange = Math.max(0, deadScrollContainer.clientHeight - thumbHeight);
    deadScrollLinks.forEach((link, index) => {
      const linkRect = link.getBoundingClientRect();
      const contentTop = linkRect.top - rect.top + deadScrollContainer.scrollTop;
      const position = Math.min(1, Math.max(0, contentTop / scrollRange));
      deadScrollTrack.children[index].style.top = `${position * markerRange}px`;
    });
  }

  function removeDeadScrollMarkers() {
    if (!deadScrollTrack) return;
    deadScrollTrack.remove();
    window.removeEventListener('resize', updateDeadScrollMarkerPositions);
    window.removeEventListener('scroll', updateDeadScrollMarkerPositions, true);
    deadScrollTrack = null;
    deadScrollContainer = null;
    deadScrollLinks = [];
  }

  function updateDeadScrollMarkers(resultLinks) {
    const deadLinks = resultLinks.filter((link) => statusByUrl.get(urlKey(link.href)) === 'morto');
    const scrollContainer = deadLinks.length ? findScrollableAncestor(deadLinks[0]) : null;
    if (!scrollContainer) {
      removeDeadScrollMarkers();
      return;
    }

    if (!deadScrollTrack) {
      deadScrollTrack = document.createElement('div');
      deadScrollTrack.setAttribute(deadScrollTrackAttribute, '');
      deadScrollTrack.setAttribute('role', 'group');
      deadScrollTrack.setAttribute('aria-label', 'Resultados classificados como Morto nesta página');
      document.documentElement.appendChild(deadScrollTrack);
      window.addEventListener('resize', updateDeadScrollMarkerPositions);
      window.addEventListener('scroll', updateDeadScrollMarkerPositions, true);
    }
    deadScrollContainer = scrollContainer;
    deadScrollLinks = deadLinks;

    while (deadScrollTrack.children.length > deadLinks.length) {
      deadScrollTrack.lastElementChild.remove();
    }
    deadLinks.forEach((link, index) => {
      let button = deadScrollTrack.children[index];
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.setAttribute(deadScrollMarkerAttribute, '');
        button.addEventListener('click', () => {
          const target = deadScrollLinks[index];
          if (!target || !deadScrollContainer) return;
          const targetRect = target.getBoundingClientRect();
          const containerRect = deadScrollContainer.getBoundingClientRect();
          const targetTop = targetRect.top - containerRect.top + deadScrollContainer.scrollTop;
          deadScrollContainer.scrollTo({
            top: Math.max(0, targetTop - deadScrollContainer.clientHeight / 3),
            behavior: 'smooth',
          });
        });
        deadScrollTrack.appendChild(button);
      }
      const label = `Ir para resultado Morto ${index + 1}`;
      button.setAttribute('aria-label', label);
      button.title = label;
    });
    updateDeadScrollMarkerPositions();
  }

  function refreshMarkers() {
    const links = [
      ...new Set([
        ...document.querySelectorAll('a[href]'),
        ...document.querySelectorAll('a[data-mv-checked-status]'),
        ...document.querySelectorAll('a[data-mv-duplicate-count]'),
      ]),
    ];
    const threatX = isThreatXHost();
    const snapshot = threatX ? threatXPageSnapshot() : null;
    if (!snapshot) threatXSession = null;
    const crossPageDuplicates = crossPageDuplicateKeys(snapshot);
    const duplicateLinks = new Set(snapshot?.links || (
      threatX ? [] : document.querySelectorAll('a[href]')
    ));
    const counts = new Map();

    for (const link of duplicateLinks) {
      const key = urlKey(link.href);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }

    for (const link of links) {
      const hrefKey = link.matches('a[href]') ? urlKey(link.href) : null;
      const status = statusByUrl.get(hrefKey) || statusByUrl.get(urlKey(link.textContent));
      if (!supportedStatuses.has(status)) {
        updateStatusBadge(link, null);
        updateDuplicateBadge(link, 0);
        continue;
      }
      updateStatusBadge(link, status);
      const isResultLink = duplicateLinks.has(link);
      updateDuplicateBadge(
        link,
        isResultLink && hrefKey ? counts.get(hrefKey) || 0 : 0,
        isResultLink && Boolean(hrefKey) && crossPageDuplicates.has(hrefKey),
      );
    }
    updateDeadScrollMarkers(snapshot?.links || []);
  }

  function isMarkerNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest?.(markerSelector));
  }

  function removeMarkersBeforeRemovedLink(record) {
    const removedAnchor = [...record.removedNodes]
      .some((node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.('a'));
    if (!removedAnchor) return;
    let sibling = record.previousSibling;
    while (sibling?.nodeType === Node.ELEMENT_NODE
      && (sibling.hasAttribute(statusBadgeAttribute)
        || sibling.hasAttribute(duplicateBadgeAttribute))) {
      const previous = sibling.previousSibling;
      sibling.remove();
      sibling = previous;
    }
  }

  function hasRelevantMutation(records) {
    let relevant = false;
    for (const record of records) {
      if (isMarkerNode(record.target)) continue;
      if (record.type === 'attributes' || record.type === 'characterData') {
        relevant = true;
        continue;
      }
      removeMarkersBeforeRemovedLink(record);
      if ([...record.addedNodes, ...record.removedNodes].some((node) => !isMarkerNode(node))) {
        relevant = true;
      }
    }
    return relevant;
  }

  function scheduleMarkerRefresh() {
    if (!active || scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      if (active) refreshMarkers();
    }, 100);
  }

  function clearMarkers() {
    document.querySelectorAll('a').forEach((link) => {
      removeBadge(link, statusBadgeAttribute, 'data-mv-checked-status');
      removeBadge(link, duplicateBadgeAttribute, 'data-mv-duplicate-count');
      link.removeAttribute('data-mv-duplicate-across-pages');
    });
    document.querySelectorAll(`[${statusBadgeAttribute}]`).forEach((badge) => badge.remove());
    document.querySelectorAll(`[${duplicateBadgeAttribute}]`).forEach((badge) => badge.remove());
  }

  function deactivate() {
    active = false;
    if (scanTimer !== null) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    observer?.disconnect();
    observer = null;
    statusByUrl = new Map();
    threatXSession = null;
    removeDeadScrollMarkers();
    clearMarkers();
  }

  function activate(history, manualClassifications) {
    const statuses = new Map();
    for (const [url, entry] of Object.entries(history || {})) {
      const status = entry?.last?.status;
      const key = urlKey(url);
      if (supportedStatuses.has(status) && key) statuses.set(key, status);
    }
    for (const [url, status] of Object.entries(manualClassifications || {})) {
      const key = urlKey(url);
      if (supportedStatuses.has(status) && key) statuses.set(key, status);
    }
    statusByUrl = statuses;
    active = true;
    refreshMarkers();
    if (!observer && document.documentElement) {
      observer = new MutationObserver((records) => {
        if (hasRelevantMutation(records)) scheduleMarkerRefresh();
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
      activate(stored.mv_history, stored.mv_manual_classifications);
    } catch (error) {
      if (revision === refreshRevision) deactivate();
      console.error('Não foi possível atualizar as marcações do Morto-Vivo nesta página:', error);
    }
  }

  globalThis[instanceKey] = { refresh, deactivate };
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.mv_settings || changes.mv_history || changes.mv_manual_classifications) refresh();
  });
  refresh();
})();
