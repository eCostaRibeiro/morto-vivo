import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containsDebuggerPermission, requestDebuggerPermission,
} from '../lib/permissions.js';

async function withChromePermissions(permissions, run) {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { permissions, runtime: { lastError: null } };
  try {
    await run(globalThis.chrome);
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  }
}

test('checks whether the debugger permission is granted', async () => {
  await withChromePermissions({
    contains: (request, callback) => {
      assert.deepEqual(request, { permissions: ['debugger'] });
      callback(true);
    },
  }, async () => {
    assert.equal(await containsDebuggerPermission(), true);
  });
});

test('requests the debugger permission and returns the user decision', async () => {
  await withChromePermissions({
    request: (request, callback) => {
      assert.deepEqual(request, { permissions: ['debugger'] });
      callback(false);
    },
  }, async () => {
    assert.equal(await requestDebuggerPermission(), false);
  });
});

test('propagates permission API errors', async () => {
  const failure = new Error('permission API unavailable');
  await withChromePermissions({
    contains: (_request, callback) => {
      globalThis.chrome.runtime.lastError = failure;
      callback(false);
      globalThis.chrome.runtime.lastError = null;
    },
  }, async () => {
    await assert.rejects(containsDebuggerPermission(), /permission API unavailable/);
  });
});

test('reports when optional permission APIs are unavailable', async () => {
  await withChromePermissions({}, async () => {
    await assert.rejects(
      requestDebuggerPermission(),
      /não permite gerenciar permissões opcionais/,
    );
  });
});
