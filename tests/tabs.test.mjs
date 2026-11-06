import assert from 'node:assert/strict';
import test from 'node:test';

import { closeReusableTab, readInTab } from '../lib/tabs.js';

test('readInTab installs the debugger network guard and blocks private destinations', async () => {
  const originalChrome = globalThis.chrome;
  const commands = [];
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  const createdListeners = new Set();
  let pageUrl = 'about:blank';
  let removed = false;
  const removedTabIds = [];

  globalThis.chrome = {
    tabs: {
      onCreated: {
        addListener: (listener) => createdListeners.add(listener),
        removeListener: (listener) => createdListeners.delete(listener),
      },
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 17 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        for (const listener of createdListeners) listener({ id: 19, openerTabId: tabId });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async (tabId) => {
        if (tabId === 17) removed = true;
        removedTabIds.push(tabId);
      },
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async (target, method, params) => {
        commands.push({ method, params });
        if (method === 'Fetch.enable') {
          for (const listener of debuggerListeners) {
            await listener(
              { tabId: target.tabId },
              'Fetch.requestPaused',
              { requestId: 'private-request', request: { url: 'http://127.0.0.1/admin' } },
            );
          }
        }
      },
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => [{
        result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
      }],
    },
  };

  try {
    const result = await readInTab('https://example.com/', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
    });
    assert.equal(result.url, 'https://example.com/');
    assert.ok(commands.some(({ method, params }) => (
      method === 'Fetch.failRequest'
      && params.requestId === 'private-request'
      && params.errorReason === 'BlockedByClient'
    )));
    assert.ok(commands.some(({ method }) => method === 'Fetch.disable'));
    assert.ok(commands.some(({ method, params }) => (
      method === 'Page.setDownloadBehavior' && params.behavior === 'deny'
    )));
    assert.ok(commands.some(({ method, params }) => (
      method === 'Page.setDownloadBehavior' && params.behavior === 'default'
    )));
    assert.ok(removedTabIds.includes(19));
    assert.equal(removed, true);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab continues when the browser does not support download behavior commands', async () => {
  const originalChrome = globalThis.chrome;
  const originalWarn = console.warn;
  const updateListeners = new Set();
  const debuggerListeners = new Set();
  const commands = [];
  const warnings = [];
  let pageUrl = 'about:blank';

  console.warn = (...args) => warnings.push(args);
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 24 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async (_target, method) => {
        commands.push(method);
        if (method === 'Page.setDownloadBehavior') {
          throw new Error('Cannot access browser-level commands');
        }
      },
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => [{
        result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
      }],
    },
  };

  try {
    const result = await readInTab('https://example.com/', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
    });

    assert.equal(result.url, 'https://example.com/');
    assert.ok(commands.includes('Fetch.enable'), 'network guard should still be enabled');
    assert.ok(commands.includes('Fetch.disable'), 'network guard should still be cleaned up');
    assert.equal(commands.filter((method) => method === 'Page.setDownloadBehavior').length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Bloqueio de downloads indisponível/);
  } finally {
    console.warn = originalWarn;
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab retries DOM capture when navigation removes the frame', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let captureAttempts = 0;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 18 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => {
        captureAttempts++;
        if (captureAttempts === 1) throw new Error('Frame with ID 0 was removed.');
        return [{
          result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
        }];
      },
    },
  };

  try {
    const result = await readInTab('https://instagram.com/example_profile', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
    });
    assert.equal(result.url, 'https://instagram.com/example_profile');
    assert.equal(captureAttempts, 2);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab reads TikTok profile DOM after navigation completes', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let captureAttempts = 0;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 21 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => {
        captureAttempts++;
        return [{
          result: {
            url: pageUrl,
            html: '<title>TikTok</title>',
            text: "Couldn't find this account",
            hasPassword: false,
          },
        }];
      },
    },
  };

  const controller = new AbortController();
  let timeout;
  const timedOut = Symbol('timed out');
  try {
    const reading = readInTab('https://www.tiktok.com/@missing_profile', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      timeout: 30000,
      commandTimeout: 100,
      waitForTikTokProfile: true,
      tiktokWait: 100,
      signal: controller.signal,
    });
    const result = await Promise.race([
      reading,
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), 500);
      }),
    ]);

    assert.notEqual(result, timedOut, 'DOM reading should not wait for the full navigation timeout');
    assert.equal(result.text, "Couldn't find this account");
    assert.equal(captureAttempts, 1);
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab reuses the same tab across sequential checks when requested', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  const updatedTabIds = [];
  let pageUrl = 'about:blank';
  let tabCreates = 0;
  let removedTabId = null;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: ++tabCreates + 30 }),
      update: async (tabId, update) => {
        updatedTabIds.push(tabId);
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async (tabId) => { removedTabId = tabId; },
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => [{
        result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
      }],
    },
  };

  try {
    const options = {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
      reuseTab: true,
    };
    await readInTab('https://www.tiktok.com/@first', options);
    await readInTab('https://www.tiktok.com/@second', options);

    assert.equal(tabCreates, 1);
    assert.equal(updatedTabIds.length, 2);
    assert.equal(updatedTabIds[0], updatedTabIds[1]);
  } finally {
    await closeReusableTab();
    assert.equal(removedTabId, 31);
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab waits for TikTok navigation to complete before reading the DOM', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let captureAttempts = 0;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 22 }),
      update: async (tabId, update) => {
        setTimeout(() => {
          pageUrl = update.url;
          for (const listener of updateListeners) listener(tabId, { status: 'loading' });
          for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        }, 20);
        return { id: tabId, url: update.url };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => {
        captureAttempts++;
        return [{
          result: {
            url: pageUrl,
            html: '<title>TikTok</title>',
            text: "Couldn't find this account",
            hasPassword: false,
          },
        }];
      },
    },
  };

  try {
    const result = await readInTab('https://www.tiktok.com/@missing_profile', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      timeout: 30000,
      commandTimeout: 100,
      waitForTikTokProfile: true,
      tiktokWait: 100,
    });

    assert.equal(result.url, 'https://www.tiktok.com/@missing_profile');
    assert.equal(result.text, "Couldn't find this account");
    assert.equal(captureAttempts, 1);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab waits for matching TikTok video state without a fixed settle delay', async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const removedState = JSON.stringify({
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { statusCode: 10204, statusMsg: 'status_deleted' },
    },
  });
  const stateElement = {
    textContent: JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: { itemStruct: { id: '987654321' } },
        },
      },
    }),
  };
  let pageUrl = 'about:blank';
  let executeOptions;

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      body: { innerText: 'Video removed' },
      documentElement: {
        get outerHTML() { return `<html>${stateElement.textContent}</html>`; },
      },
      head: { outerHTML: '<title>TikTok</title>' },
      getElementById: () => stateElement,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { href: url, pathname: '/@creator/video/123456789' },
  });
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {
      setTimeout(() => {
        stateElement.textContent = removedState;
        this.callback();
      }, 10);
    }
    disconnect() {}
  };
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 23 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async (options) => {
        executeOptions = options;
        return [{ result: await options.func(...options.args) }];
      },
    },
  };

  try {
    const result = await readInTab(url, {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      commandTimeout: 100,
      waitForTikTokContent: true,
      tiktokContentWait: 20000,
    });

    assert.equal(result.url, url);
    assert.match(result.html, /"statusMsg":"status_deleted"/);
    assert.equal(executeOptions.args[5], true);
    assert.equal(executeOptions.args[6], 20000);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', originalDocument);
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', originalLocation);
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver;
    else Object.defineProperty(globalThis, 'MutationObserver', originalMutationObserver);
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab activates TikTok navigation immediately and restores the previous tab', async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const originalMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const deletedState = JSON.stringify({
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { statusCode: 10204, statusMsg: 'status_deleted' },
    },
  });
  const stateElement = {
    textContent: JSON.stringify({
      __DEFAULT_SCOPE__: {
        'webapp.video-detail': {
          statusCode: 0,
          itemInfo: { itemStruct: { id: '987654321' } },
        },
      },
    }),
  };
  let pageUrl = 'about:blank';
  let activeTabId = 11;
  const activeChanges = [];
  const navigationUpdates = [];

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      body: { innerText: 'A public video' },
      documentElement: { get outerHTML() { return `<html>${stateElement.textContent}</html>`; } },
      head: { outerHTML: '<title>TikTok</title>' },
      getElementById: () => stateElement,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { href: url, pathname: '/@creator/video/123456789' },
  });
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 24, windowId: 1 }),
      query: async () => [{ id: activeTabId, windowId: 1 }],
      update: async (tabId, update) => {
        if (update.url) {
          navigationUpdates.push({ ...update });
          pageUrl = update.url;
          for (const listener of updateListeners) listener(tabId, { status: 'loading' });
          for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        }
        if (update.active) {
          stateElement.textContent = deletedState;
          activeTabId = tabId;
          activeChanges.push(tabId);
        }
        return { id: tabId, windowId: 1, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, windowId: 1, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async ({ func, args }) => [{ result: await func(...args) }],
    },
  };

  try {
    const result = await readInTab(url, {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      commandTimeout: 100,
      reuseTab: true,
      waitForTikTokContent: true,
      tiktokContentWait: 30,
      activateTab: true,
    });

    assert.equal(result.url, url);
    assert.match(result.html, /"statusMsg":"status_deleted"/);
    assert.deepEqual(navigationUpdates, [{ url, active: true }]);
    assert.deepEqual(activeChanges, [24, 11]);
    assert.equal(activeTabId, 11);
  } finally {
    await closeReusableTab();
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', originalDocument);
    if (originalLocation === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', originalLocation);
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver;
    else Object.defineProperty(globalThis, 'MutationObserver', originalMutationObserver);
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab returns a TikTok anti-bot challenge without waiting for the profile timeout', async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let watchdog;

  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    body: { innerText: 'Security check. Please wait while we verify your browser.' },
    documentElement: { outerHTML: '<html><body>Security check</body></html>' },
    head: { outerHTML: '<title>TikTok</title>' },
    querySelector: () => null,
    querySelectorAll: () => [],
  } });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { href: 'https://www.tiktok.com/@creator', pathname: '/@creator' },
  });
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 23 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        globalThis.location.href = update.url;
        globalThis.location.pathname = new URL(update.url).pathname;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async ({ func, args }) => [{ result: await func(...args) }],
    },
  };

  try {
    const result = await Promise.race([
      readInTab('https://www.tiktok.com/@creator', {
        resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
        timeout: 1000,
        commandTimeout: 100,
        reuseTab: true,
        waitForTikTokProfile: true,
        tiktokWait: 45000,
      }),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('TikTok challenge waited for the full profile timeout')), 500);
      }),
    ]);
    assert.equal(result.text, 'Security check. Please wait while we verify your browser.');
  } finally {
    clearTimeout(watchdog);
    try {
      await closeReusableTab();
    } finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
      if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
      else delete globalThis.location;
    }
  }
});

test('readInTab returns a TikTok unavailable-profile message with surrounding page text without waiting', async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let watchdog;

  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    body: { innerText: `Não foi possível localizar esta conta. ${'TikTok navigation and footer content. '.repeat(30)}` },
    documentElement: { outerHTML: '<html><body>Account unavailable</body></html>' },
    head: { outerHTML: '<title>TikTok</title>' },
    querySelector: () => null,
    querySelectorAll: () => [{
      innerText: 'Para você',
      getClientRects: () => [{}],
    }],
  } });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { href: 'https://www.tiktok.com/@missing_profile', pathname: '/@missing_profile' },
  });
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 24 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        globalThis.location.href = update.url;
        globalThis.location.pathname = new URL(update.url).pathname;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async ({ func, args }) => [{ result: await func(...args) }],
    },
  };

  try {
    const result = await Promise.race([
      readInTab('https://www.tiktok.com/@missing_profile', {
        resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
        timeout: 1000,
        commandTimeout: 100,
        reuseTab: true,
        waitForTikTokProfile: true,
        tiktokWait: 45000,
      }),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Unavailable TikTok profile waited for the full evidence timeout')), 500);
      }),
    ]);

    assert.match(result.text, /Não foi possível localizar esta conta/);
  } finally {
    clearTimeout(watchdog);
    try {
      await closeReusableTab();
    } finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
      if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
      else delete globalThis.location;
    }
  }
});

test('readInTab finds an unavailable TikTok profile after long navigation text without waiting', async () => {
  const originalChrome = globalThis.chrome;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let watchdog;
  const renderedText = `${'TikTok navigation and recommendations. '.repeat(60)}Couldn't find this account.`;

  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: {
    body: { innerText: renderedText },
    documentElement: { outerHTML: '<html><body>Account unavailable</body></html>' },
    head: { outerHTML: '<title>TikTok</title>' },
    querySelector: () => null,
    querySelectorAll: () => [],
  } });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { href: 'https://www.tiktok.com/@missing_profile', pathname: '/@missing_profile' },
  });
  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 25 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        globalThis.location.href = update.url;
        globalThis.location.pathname = new URL(update.url).pathname;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async ({ func, args }) => [{ result: await func(...args) }],
    },
  };

  try {
    const result = await Promise.race([
      readInTab('https://www.tiktok.com/@missing_profile', {
        resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
        timeout: 1000,
        commandTimeout: 100,
        reuseTab: true,
        waitForTikTokProfile: true,
        tiktokWait: 45000,
      }),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Unavailable TikTok profile waited for the full evidence timeout')), 500);
      }),
    ]);

    assert.match(result.text, /Couldn't find this account/);
  } finally {
    clearTimeout(watchdog);
    try {
      await closeReusableTab();
    } finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
      if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
      else delete globalThis.location;
    }
  }
});

test('readInTab opens a fresh guarded tab when the previous tab disappears', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let tabCreates = 0;
  let captureAttempts = 0;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: ++tabCreates + 18 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => {},
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: async () => {
        captureAttempts++;
        if (captureAttempts === 1) throw new Error('No tab with id: 19');
        return [{
          result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
        }];
      },
    },
  };

  try {
    const result = await readInTab('https://instagram.com/example_profile', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
    });
    assert.equal(result.url, 'https://instagram.com/example_profile');
    assert.equal(tabCreates, 2);
    assert.equal(captureAttempts, 2);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab keeps the tab open until asynchronous DOM capture completes', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let removed = false;
  let resolveCapture;
  let captureStarted;
  const captureStartedPromise = new Promise((resolve) => { captureStarted = resolve; });

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 20 }),
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => ({ id: tabId, url: pageUrl }),
      remove: async () => { removed = true; },
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async () => {},
      sendCommand: async () => {},
      detach: async () => {},
    },
    scripting: {
      executeScript: () => {
        captureStarted();
        return new Promise((resolve) => { resolveCapture = resolve; });
      },
    },
  };

  try {
    const reading = readInTab('https://instagram.com/example_profile', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 100,
      commandTimeout: 100,
    });
    await captureStartedPromise;
    assert.equal(removed, false);
    resolveCapture([{
      result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
    }]);
    const result = await reading;
    assert.equal(result.url, 'https://instagram.com/example_profile');
    assert.equal(removed, true);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
});

test('readInTab releases the tab semaphore after cancellation closes the guarded tab', async () => {
  const originalChrome = globalThis.chrome;
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let nextTabId = 40;
  let activeTabId = null;
  let debuggerAttached = false;
  const controller = new AbortController();
  let firstNavigation = true;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => {
        activeTabId = ++nextTabId;
        pageUrl = 'about:blank';
        return { id: activeTabId };
      },
      update: async (tabId, update) => {
        pageUrl = update.url;
        for (const listener of updateListeners) listener(tabId, { status: 'loading' });
        for (const listener of updateListeners) listener(tabId, { status: 'complete' });
        if (firstNavigation) {
          firstNavigation = false;
          controller.abort();
        }
        return { id: tabId, url: pageUrl };
      },
      get: async (tabId) => {
        if (tabId !== activeTabId) throw new Error('No tab with id: ' + tabId);
        return { id: tabId, url: pageUrl };
      },
      remove: async (tabId) => {
        if (tabId === activeTabId) {
          activeTabId = null;
          debuggerAttached = false;
        }
      },
    },
    debugger: {
      onEvent: {
        addListener: (listener) => debuggerListeners.add(listener),
        removeListener: (listener) => debuggerListeners.delete(listener),
      },
      attach: async ({ tabId }) => {
        if (tabId !== activeTabId) throw new Error('No tab with id: ' + tabId);
        debuggerAttached = true;
      },
      sendCommand: async ({ tabId }, method) => {
        if (!debuggerAttached || tabId !== activeTabId) throw new Error('Debugger is not attached.');
        if (method === 'Page.setDownloadBehavior' && tabId !== activeTabId) {
          throw new Error('No tab with id: ' + tabId);
        }
      },
      detach: async () => { debuggerAttached = false; },
    },
    scripting: {
      executeScript: async () => {
        return [{
          result: { url: pageUrl, html: '<title>loaded</title>', text: 'loaded', hasPassword: false },
        }];
      },
    },
  };
  try {
    const cancelledRead = readInTab('https://instagram.com/first', {
      resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
      settle: 0,
      timeout: 1000,
      commandTimeout: 100,
      reuseTab: true,
      signal: controller.signal,
    });
    await assert.rejects(cancelledRead, { name: 'AbortError' });

    let watchdog;
    const nextRead = await Promise.race([
      readInTab('https://instagram.com/second', {
        resolveHost: async () => ({ hasAddress: true, addresses: ['93.184.216.34'] }),
        settle: 0,
        timeout: 100,
        commandTimeout: 100,
        reuseTab: true,
      }),
      new Promise((_, reject) => {
        watchdog = setTimeout(() => reject(new Error('Tab semaphore remained locked')), 500);
      }),
    ]);
    clearTimeout(watchdog);
    assert.equal(nextRead.url, 'https://instagram.com/second');
  } finally {
    try {
      await closeReusableTab();
    } finally {
      if (originalChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = originalChrome;
    }
  }
});
