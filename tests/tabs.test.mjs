import assert from 'node:assert/strict';
import test from 'node:test';

import { readInTab } from '../lib/tabs.js';

test('readInTab installs the debugger network guard and blocks private destinations', async () => {
  const originalChrome = globalThis.chrome;
  const commands = [];
  const debuggerListeners = new Set();
  const updateListeners = new Set();
  let pageUrl = 'about:blank';
  let removed = false;

  globalThis.chrome = {
    tabs: {
      onUpdated: {
        addListener: (listener) => updateListeners.add(listener),
        removeListener: (listener) => updateListeners.delete(listener),
      },
      create: async () => ({ id: 17 }),
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
    assert.equal(removed, true);
  } finally {
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
