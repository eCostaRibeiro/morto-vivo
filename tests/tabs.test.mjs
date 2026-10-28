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
