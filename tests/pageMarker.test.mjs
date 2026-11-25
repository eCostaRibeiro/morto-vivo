import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pageMarkerSource = await readFile(new URL('../pageMarker.js', import.meta.url), 'utf8');

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.parentElement = null;
    this.className = '';
    this.textContent = '';
    this.title = '';
    this.style = {};
    this.listeners = new Map();
    this.clientHeight = 0;
    this.clientWidth = 0;
    this.offsetWidth = 0;
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.rect = { top: 0, right: 0 };
    this.lastScroll = null;
    this.computedOverflowY = 'visible';
    this.type = '';
  }

  get href() { return this.attributes.get('href') || ''; }

  set href(value) { this.setAttribute('href', value); }

  get innerText() { return this.textContent; }

  set innerText(value) { this.textContent = String(value); }

  get previousSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index - 1] || null;
  }

  get previousElementSibling() { return this.previousSibling; }

  get lastElementChild() { return this.children.at(-1) || null; }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  hasAttribute(name) { return this.attributes.has(name); }

  removeAttribute(name) { this.attributes.delete(name); }

  matches(selector) {
    return selector.split(',').some((part) => {
      const value = part.trim();
      if (value === 'a') return this.tagName === 'A';
      if (value === 'a[href]') return this.tagName === 'A' && this.hasAttribute('href');
      if (value === 'p') return this.tagName === 'P';
      if (value === 'button') return this.tagName === 'BUTTON';
      if (value === 'input') return this.tagName === 'INPUT';
      if (value === '[role="tab"]') return this.getAttribute('role') === 'tab';
      if (value === 'a[data-mv-checked-status]') {
        return this.tagName === 'A' && this.hasAttribute('data-mv-checked-status');
      }
      if (value === 'a[data-mv-duplicate-count]') {
        return this.tagName === 'A' && this.hasAttribute('data-mv-duplicate-count');
      }
      if (value === '[data-mv-history-badge]') return this.hasAttribute('data-mv-history-badge');
      if (value === '[data-mv-duplicate-badge]') return this.hasAttribute('data-mv-duplicate-badge');
      if (value === '[data-mv-dead-scroll-track]') return this.hasAttribute('data-mv-dead-scroll-track');
      return false;
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (element.matches?.(selector)) return element;
    }
    return null;
  }

  appendChild(child) {
    child.parentElement?.removeChild(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  before(node) {
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    node.parentElement = this.parentElement;
    siblings.splice(index, 0, node);
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    return child;
  }

  remove() { this.parentElement?.removeChild(this); }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  click() { this.listeners.get('click')?.forEach((listener) => listener()); }

  getBoundingClientRect() { return { ...this.rect, left: 0, width: 100, height: this.clientHeight }; }

  scrollTo(options) {
    this.lastScroll = options;
    this.scrollTop = options.top;
  }
}

async function createHarness(linkSpecs, history, options = {}) {
  const elements = [];
  const timers = new Map();
  const observers = [];
  const storageChangeListeners = [];
  let currentHistory = history;
  let nextTimerId = 0;
  let currentUrl = options.url || 'https://example.test/';
  const documentElement = new MockElement('html');
  const body = documentElement.appendChild(new MockElement('body'));
  elements.push(documentElement, body);

  function makeElement(tagName, parent = body, attributes = {}, text = '') {
    const element = new MockElement(tagName);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.textContent = text;
    elements.push(element);
    parent.appendChild(element);
    return element;
  }

  function makeLink({ href, text = '', top = 0 }, parent = body) {
    const link = new MockElement('a');
    link.href = href;
    link.textContent = text;
    link.rect.top = top;
    elements.push(link);
    parent.appendChild(link);
    return link;
  }

  let cards;
  let rangeNode;
  let totalResults;
  const pageSize = options.pageSize || 100;
  const includePageLimit = options.includePageLimit !== false;
  let filterChip;
  let scrollContainer;
  if (options.threatX) {
    totalResults = options.totalResults || 1000;
    scrollContainer = makeElement('main');
    scrollContainer.computedOverflowY = 'auto';
    scrollContainer.clientHeight = 600;
    scrollContainer.scrollHeight = 1800;
    scrollContainer.offsetWidth = 1000;
    scrollContainer.clientWidth = 985;
    scrollContainer.rect = { top: 80, right: 1100 };
    const filters = makeElement('div', scrollContainer);
    filterChip = makeElement('button', filters, {}, options.filter || 'Status: Em andamento');
    makeElement('button', filters, {}, 'Resetar filtros');
    makeElement('div', scrollContainer, { role: 'tab', 'aria-selected': 'true' }, 'Anúncios 1000');
    makeElement('input', scrollContainer, { placeholder: 'Pesquise pela URL de uma ameaça' });
    const results = makeElement('div', scrollContainer);
    const toolbar = makeElement('div', results);
    rangeNode = makeElement('p', toolbar);
    cards = makeElement('div', results);
  }
  const links = linkSpecs.map((spec) => makeLink(spec, cards || body));
  if (options.threatX) setThreatXPage(options.pageNumber || 1, linkSpecs);

  function setThreatXPage(pageNumber, nextLinkSpecs) {
    const url = new URL(currentUrl);
    url.searchParams.set('page', String(pageNumber));
    if (includePageLimit) url.searchParams.set('limit', String(pageSize));
    else url.searchParams.delete('limit');
    currentUrl = url.href;
    const start = ((pageNumber - 1) * pageSize) + 1;
    const end = Math.min(pageNumber * pageSize, totalResults);
    rangeNode.textContent = `Mostrando ${start} até ${end} de ${totalResults} resultados`;
    for (const row of [...cards.children]) row.remove();
    const nextLinks = nextLinkSpecs.map((spec) => {
      const row = makeElement('div', cards);
      return makeLink(spec, row);
    });
    return nextLinks;
  }

  const document = {
    documentElement,
    body,
    scrollingElement: documentElement,
    createElement(tagName) {
      const element = new MockElement(tagName);
      elements.push(element);
      return element;
    },
    querySelectorAll(selector) {
      function isConnected(element) {
        for (let parent = element; parent; parent = parent.parentElement) {
          if (parent === documentElement) return true;
        }
        return false;
      }
      return elements.filter((element) => isConnected(element) && element.matches(selector));
    },
  };
  const location = {
    get href() { return currentUrl; },
  };
  const windowListeners = new Map();
  const window = {
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
    },
  };
  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}
    disconnect() {}
  }
  const chrome = {
    storage: {
      local: {
        get: async () => ({
          mv_settings: { markCheckedUrls: true },
          mv_history: currentHistory,
          mv_manual_classifications: {},
        }),
      },
      onChanged: {
        addListener(listener) { storageChangeListeners.push(listener); },
      },
    },
  };
  const context = {
    URL,
    Node: { ELEMENT_NODE: 1 },
    chrome,
    document,
    location,
    window,
    getComputedStyle(element) { return { overflowY: element.computedOverflowY }; },
    MutationObserver: MockMutationObserver,
    setTimeout(callback) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };

  vm.runInNewContext(pageMarkerSource, context);
  await new Promise((resolve) => setImmediate(resolve));

  return {
    body,
    links,
    makeLink,
    cards,
    rangeNode,
    setThreatXPage,
    scrollContainer,
    setFilter(value) { if (filterChip) filterChip.textContent = value; },
    async updateHistory(nextHistory) {
      currentHistory = nextHistory;
      storageChangeListeners.forEach((listener) => listener({ mv_history: {} }, 'local'));
      await new Promise((resolve) => setImmediate(resolve));
    },
    getThreatXLinks() { return cards?.querySelectorAll('a[href]') || []; },
    getDeadScrollTrack() {
      return document.querySelectorAll('[data-mv-dead-scroll-track]')[0] || null;
    },
    observer: observers[0],
    timers,
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

function badgeText(link, attribute) {
  for (let sibling = link.previousElementSibling;
    sibling?.hasAttribute('data-mv-history-badge')
      || sibling?.hasAttribute('data-mv-duplicate-badge');
    sibling = sibling.previousElementSibling) {
    if (sibling.hasAttribute(attribute)) return sibling.textContent;
  }
  return null;
}

function badgeElement(link, attribute) {
  for (let sibling = link.previousElementSibling;
    sibling?.hasAttribute('data-mv-history-badge')
      || sibling?.hasAttribute('data-mv-duplicate-badge');
    sibling = sibling.previousElementSibling) {
    if (sibling.hasAttribute(attribute)) return sibling;
  }
  return null;
}

test('marks repeated normalized URLs beside their saved status only', async () => {
  const history = {
    'https://example.com/item': { last: { status: 'vivo' } },
    'https://other.example/item': { last: { status: 'morto' } },
  };
  const harness = await createHarness([
    { href: 'https://Example.com/item' },
    { href: 'https://example.com/item/' },
    { href: 'https://other.example/item' },
    { href: 'https://unknown.example/item' },
    { href: 'https://unknown.example/item/' },
  ], history);
  const { links } = harness;

  for (const link of links.slice(0, 2)) {
    assert.equal(badgeText(link, 'data-mv-history-badge'), 'vivo');
    assert.equal(badgeText(link, 'data-mv-duplicate-badge'), 'DUPLICADA ×2');
    assert.equal(link.getAttribute('data-mv-duplicate-count'), '2');
  }
  assert.equal(badgeText(links[2], 'data-mv-history-badge'), 'morto');
  assert.equal(badgeText(links[2], 'data-mv-duplicate-badge'), null);
  assert.equal(badgeText(links[3], 'data-mv-duplicate-badge'), null);
  assert.equal(badgeText(links[4], 'data-mv-duplicate-badge'), null);
  assert.equal(harness.getDeadScrollTrack(), null);
});

test('updates saved statuses in place without removing and recreating badges', async () => {
  const url = 'https://example.com/item';
  const harness = await createHarness([
    { href: url },
  ], { [url]: { last: { status: 'vivo' } } });
  const statusBadge = badgeElement(harness.links[0], 'data-mv-history-badge');
  assert.equal(statusBadge.textContent, 'vivo');

  await harness.updateHistory({ [url]: { last: { status: 'morto' } } });

  assert.strictEqual(badgeElement(harness.links[0], 'data-mv-history-badge'), statusBadge);
  assert.equal(statusBadge.textContent, 'morto');
});

test('recounts dynamically added links and ignores its own badge mutations', async () => {
  const history = { 'https://example.com/item': { last: { status: 'vivo' } } };
  const { body, links, makeLink, observer, timers, flushTimers } = await createHarness([
    { href: 'https://example.com/item' },
    { href: 'https://example.com/item/' },
  ], history);
  assert.equal(badgeText(links[0], 'data-mv-duplicate-badge'), 'DUPLICADA ×2');

  const thirdLink = makeLink({ href: 'https://example.com/item' });
  observer.callback([{
    type: 'childList',
    target: body,
    addedNodes: [thirdLink],
    removedNodes: [],
  }]);
  flushTimers();
  assert.equal(badgeText(links[0], 'data-mv-duplicate-badge'), 'DUPLICADA ×3');
  assert.equal(badgeText(thirdLink, 'data-mv-duplicate-badge'), 'DUPLICADA ×3');

  observer.callback([{
    type: 'childList',
    target: body,
    addedNodes: [thirdLink.previousElementSibling],
    removedNodes: [],
  }]);
  assert.equal(timers.size, 0);

  const badge = thirdLink.previousElementSibling;
  observer.callback([{
    type: 'childList',
    target: badge,
    addedNodes: [{ nodeType: 3, parentElement: badge }],
    removedNodes: [{ nodeType: 3, parentElement: null }],
  }]);
  assert.equal(timers.size, 0);

  const previousSibling = thirdLink.previousSibling;
  body.removeChild(thirdLink);
  observer.callback([{
    type: 'childList',
    target: body,
    addedNodes: [],
    removedNodes: [thirdLink],
    previousSibling,
  }]);
  flushTimers();
  assert.equal(badgeText(links[0], 'data-mv-duplicate-badge'), 'DUPLICADA ×2');
  assert.equal(links[0].parentElement.children.filter(
    (element) => element.hasAttribute('data-mv-duplicate-badge'),
  ).length, 2);
});

test('marks ThreatX results seen on another pagination page and resets after a filter change', async () => {
  const resultUrl = 'https://www.facebook.com/marketplace/item/123456789/';
  const history = { [resultUrl]: { last: { status: 'vivo' } } };
  const harness = await createHarness([
    { href: resultUrl },
  ], history, {
    threatX: true,
    url: 'https://cyber.threatx.com.br/cyber-operations/threats?page=1&limit=100',
    pageNumber: 1,
  });
  assert.equal(badgeText(harness.links[0], 'data-mv-duplicate-badge'), null);

  const [pageTwoLink] = harness.setThreatXPage(2, [{ href: resultUrl }]);
  harness.observer.callback([{
    type: 'childList',
    target: harness.cards,
    addedNodes: [pageTwoLink.parentElement],
    removedNodes: harness.links,
    previousSibling: null,
  }]);
  harness.flushTimers();
  assert.equal(badgeText(pageTwoLink, 'data-mv-duplicate-badge'), 'DUPLICADA');
  assert.equal(pageTwoLink.getAttribute('data-mv-duplicate-across-pages'), 'true');

  const [rerenderedLink] = harness.setThreatXPage(2, [{ href: resultUrl }]);
  harness.observer.callback([{
    type: 'childList',
    target: harness.cards,
    addedNodes: [rerenderedLink.parentElement],
    removedNodes: [pageTwoLink],
    previousSibling: null,
  }]);
  harness.flushTimers();
  assert.equal(badgeText(rerenderedLink, 'data-mv-duplicate-badge'), 'DUPLICADA');

  harness.setFilter('Status: Cliente');
  const [newSearchLink] = harness.setThreatXPage(1, [{ href: resultUrl }]);
  harness.observer.callback([{
    type: 'childList',
    target: harness.cards,
    addedNodes: [newSearchLink.parentElement],
    removedNodes: [rerenderedLink],
    previousSibling: null,
  }]);
  harness.flushTimers();
  assert.equal(badgeText(newSearchLink, 'data-mv-duplicate-badge'), null);
});

test('shows clickable scrollbar markers only for dead ThreatX results', async () => {
  const deadUrl = 'https://example.com/dead';
  const zombieUrl = 'https://example.com/zombie';
  const harness = await createHarness([
    { href: deadUrl, top: 500 },
    { href: zombieUrl, top: 800 },
  ], {
    [deadUrl]: { last: { status: 'morto' } },
    [zombieUrl]: { last: { status: 'zumbi' } },
  }, {
    threatX: true,
    url: 'https://cyber.threatx.com.br/cyber-operations/threats?page=2&limit=100',
    pageNumber: 2,
  });

  const track = harness.getDeadScrollTrack();
  assert.ok(track);
  assert.equal(track.children.length, 1);
  assert.equal(track.children[0].getAttribute('aria-label'), 'Ir para resultado Morto 1');
  assert.equal(track.children[0].style.top, '140px');

  track.children[0].click();
  assert.equal(harness.scrollContainer.lastScroll.top, 220);
  assert.equal(harness.scrollContainer.lastScroll.behavior, 'smooth');

  await harness.updateHistory({
    [deadUrl]: { last: { status: 'zumbi' } },
    [zombieUrl]: { last: { status: 'zumbi' } },
  });
  assert.equal(harness.getDeadScrollTrack(), null);
});

test('shows dead-result scrollbar markers on other paginated ThreatX result routes', async () => {
  const deadUrl = 'https://area.example/fake-page';
  const harness = await createHarness([
    { href: deadUrl, top: 500 },
  ], {
    [deadUrl]: { last: { status: 'morto' } },
  }, {
    threatX: true,
    url: 'https://cyber.threatx.com.br/fake-pages/fake-page?page=1',
    pageNumber: 1,
    pageSize: 20,
    includePageLimit: false,
    totalResults: 321,
  });

  assert.equal(new URL(harness.getThreatXLinks()[0].href).origin, 'https://area.example');
  const track = harness.getDeadScrollTrack();
  assert.ok(track);
  assert.equal(track.children.length, 1);
  assert.equal(track.children[0].getAttribute('aria-label'), 'Ir para resultado Morto 1');
});
