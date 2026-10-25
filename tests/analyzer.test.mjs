import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUrl } from '../lib/analyzer.js';
import { classifyPage } from '../lib/classification.js';
import { NetworkSafetyError } from '../lib/networkSafety.js';
import { detectPlatform } from '../lib/rules.js';

test('classifies HTTP 404 and 410 as dead links', () => {
  for (const [status, expectedReason] of [
    [404, 'Não encontrado (HTTP 404)'],
    [410, 'Removido permanentemente (HTTP 410)'],
  ]) {
    const result = classifyPage({ url: 'https://example.com/item', status });
    assert.equal(result.status, 'morto');
    assert.equal(result.reason, expectedReason);
  }
});

test('treats a temporary server failure as a zombie result', () => {
  const result = classifyPage({ url: 'https://example.com/', status: 503 });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Erro de servidor (HTTP 503)');
});

test('classifies Cloudflare 522 interstitials as server timeouts, not takedowns', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: null,
    via: 'tab',
    html: `
      <title>Connection timed out | Error code 522</title>
      <p>The initial connection between Cloudflare's network and the origin web server timed out.</p>
      <p>Your browser is working. Cloudflare is working. Host error.</p>
    `,
  });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Timeout no servidor de origem (Cloudflare 522)');
  assert.deepEqual(result.tags, []);
});

test('does not treat a phishing reputation warning as proof of takedown', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: `
      <h1>Warning</h1>
      <h2>Suspected Phishing</h2>
      <p>This website has been reported for potential phishing.</p>
      <p>Phishing is when a site attempts to steal sensitive information by falsely presenting as a safe source.</p>
      <a>Learn More</a>
      <a>Ignore &amp; Proceed</a>
      <p>Success! Cloudflare</p>
    `,
  });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /aviso de reputação\/possível phishing/i);
  assert.deepEqual(result.tags, []);
});

test('keeps explicit provider suspension classified as takedown', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<p>This website has been suspended by the hosting provider.</p>',
  });
  assert.equal(result.status, 'morto');
  assert.deepEqual(result.tags, ['takedown']);
});

test('does not treat Facebook HTTP 404 as proof that content was removed', () => {
  const url = 'https://www.facebook.com/profile.php?id=123';
  const result = classifyPage({
    url,
    status: 404,
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /não confirma que o perfil\/conteúdo foi removido/);
});

test('classifies a TikTok profile with a rendered profile heading as alive', () => {
  const url = 'https://www.tiktok.com/@j10002032';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'J10002032',
    renderedText: 'J10002032 videos and profile',
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Perfil público encontrado');
});

test('keeps a TikTok profile challenge without a rendered profile heading indeterminate', () => {
  const url = 'https://www.tiktok.com/@j10002032';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedText: 'Please wait...',
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.reason, 'TikTok apresentou uma tela de espera ou verificação anti-bot');
  assert.deepEqual(result.tags, ['anti-bot']);
});

test('does not treat a TikTok challenge heading as evidence of a live profile', () => {
  const url = 'https://www.tiktok.com/@j10002032';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Please wait',
    renderedText: 'Please wait...',
  });
  assert.equal(result.status, 'indeterminado');
});

test('does not treat a TikTok login heading as evidence of a live profile', () => {
  const url = 'https://www.tiktok.com/@j10002032';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Log in',
    renderedText: 'Log in to continue',
  });
  assert.equal(result.status, 'indeterminado');
});

test('classifies a TikTok video from matching public video state', () => {
  const url = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: {
          itemStruct: {
            id: '7673282406937333000',
            desc: 'Vídeo público de teste',
            author: { uniqueId: 'angl.o5', nickname: 'Angel' },
          },
        },
      },
    },
  };
  const result = classifyPage({
    url,
    finalUrl: url,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Vídeo público encontrado no TikTok');
  assert.equal(result.meta.og['og:title'], 'Angel: Vídeo público de teste');
});

test('uses TikTok server-rendered video state before requiring browser mode', async () => {
  const url = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: {
          itemStruct: {
            id: '7673282406937333000',
            desc: 'Vídeo público de teste',
            author: { uniqueId: 'angl.o5', nickname: 'Angel' },
          },
        },
      },
    },
  };
  const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => requestUrl.includes('/oembed?')
      ? new Response(JSON.stringify({ type: 'video', embed_product_id: '7673282406937333000' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
      : new Response(page, { status: 200, headers: { 'content-type': 'text/html' } }),
    opts: { tabMode: false, timeoutMs: 50 },
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Vídeo público encontrado no TikTok');
  assert.equal(result.title, 'Angel: Vídeo público de teste');
  assert.equal(result.via, 'fetch');
});

test('classifies a TikTok video as removed from the explicit deleted state', () => {
  const url = 'https://www.tiktok.com/@gaelymarianajeans/video/7683333996268309767';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { statusCode: 10204, statusMsg: 'status_deleted' },
    },
  };
  const result = classifyPage({
    url,
    finalUrl: url,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Vídeo removido segundo o estado público do TikTok');
});

test('does not use TikTok video state when its ID differs from the URL', () => {
  const url = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: { itemStruct: { id: '1111111111111111111', desc: 'Outro vídeo' } },
      },
    },
  };
  const result = classifyPage({
    url,
    finalUrl: url,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'indeterminado');
});

test('does not classify a TikTok video as alive when its state reports an error', () => {
  const url = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 10202,
        itemInfo: {
          itemStruct: { id: '7673282406937333000', desc: 'Stale video data' },
        },
      },
    },
  };
  const result = classifyPage({
    url,
    finalUrl: url,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'indeterminado');
});

test('classifies anti-bot responses as indeterminate', () => {
  const result = classifyPage({ url: 'https://example.com/', status: 429 });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /anti-bot\/captcha/);
});

test('classifies parked pages as zombies and keeps JavaScript platform shells indeterminate', () => {
  const parked = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<title>This domain is for sale</title>',
  });
  assert.equal(parked.status, 'zumbi');

  const instagram = classifyPage({
    url: 'https://www.instagram.com/example/',
    status: 200,
    html: '<title>Example • Instagram</title>',
    platform: detectPlatform(new URL('https://www.instagram.com/example/')),
  });
  assert.equal(instagram.status, 'indeterminado');
  assert.match(instagram.reason, /modo aba/);
});

test('treats network timeouts as indeterminate even when DNS resolves publicly', async () => {
  const timeout = new Error('network timeout');
  timeout.name = 'AbortError';
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => { throw timeout; },
    opts: { timeoutMs: 50 },
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.reason, 'Sem resposta (timeout)');
});

test('does not treat DNS failures or sinkholes as proof that a domain is dead', async () => {
  const cases = [
    { dns: { rcode: 2, servfail: true, hasAddress: false, addresses: [] }, reason: /SERVFAIL/ },
    { dns: { rcode: 0, hasAddress: false, addresses: [] }, reason: /sem registro A\/AAAA/ },
    { dns: { rcode: 0, hasAddress: true, sinkhole: true, addresses: ['10.0.0.1'] }, reason: /sinkhole/ },
  ];
  for (const { dns, reason } of cases) {
    let dnsCalls = 0;
    const result = await checkUrl('https://example.com/', {
      doh: async () => {
        dnsCalls++;
        return dnsCalls === 1
          ? { rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }
          : dns;
      },
      fetchFn: async () => { throw new TypeError('network failure'); },
    });
    assert.equal(result.status, 'indeterminado');
    assert.match(result.reason, reason);
  }
});

test('uses tab mode for supported platforms when the initial fetch fails', async () => {
  let tabReads = 0;
  const result = await checkUrl('https://instagram.com/example_profile', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
    readTab: async (url) => {
      tabReads++;
      return {
        url,
        html: '<title>Example Profile • Instagram</title>',
        text: 'Example Profile public account content',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(tabReads, 1);
  assert.equal(result.via, 'tab');
  assert.equal(result.status, 'vivo');
});

test('uses guarded tab mode when fetch cannot expose a platform redirect', async () => {
  let tabReads = 0;
  const result = await checkUrl('https://instagram.com/example_profile', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async (url) => {
      tabReads++;
      return {
        url: 'https://www.instagram.com/example_profile/',
        html: '<title>Example Profile • Instagram</title>',
        text: 'Example Profile public account content',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(tabReads, 1);
  assert.equal(result.via, 'tab');
  assert.equal(result.info.tabAttempted, true);
  assert.equal(result.info.tabFallback, 'DOM da página lido em aba');
  assert.equal(result.status, 'vivo');
});

test('uses the Facebook profile heading when the page title is generic', async () => {
  const url = 'https://facebook.com/terra.vivo.fibra';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => ({
      url: 'https://www.facebook.com/terra.vivo.fibra',
      heading: 'Terra Vivo Fibra',
      html: '<title>(16) Facebook</title>',
      text: 'Terra Vivo Fibra Intro Posts Photos About Public page with recent profile information and visible content for visitors.',
      hasPassword: false,
    }),
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.title, 'Terra Vivo Fibra');
});

test('uses a rendered TikTok profile heading to classify and title the profile', async () => {
  const url = 'https://www.tiktok.com/@j10002032';
  let tabOptions;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async (_url, options) => {
      tabOptions = options;
      return {
        url,
        heading: 'J10002032',
        html: '<title>TikTok - Make Your Day</title>',
        text: 'J10002032 videos and profile',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.title, 'J10002032');
  assert.equal(result.info.tabHeading, 'J10002032');
  assert.equal(tabOptions.waitForTikTokProfile, true);
  assert.equal(tabOptions.tiktokWait, 20000);
});

test('uses the Facebook public profile description when no heading is available', async () => {
  const url = 'https://facebook.com/TerraFibraPF';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => ({
      url: 'https://www.facebook.com/TerraFibraPF',
      html: '<title>(16) Facebook</title><meta property="og:description" content="Terra Fibra is on Facebook. Join Facebook to connect with Terra Fibra and others you may know.">',
      text: 'Terra Fibra Intro Posts Photos About Public page with recent profile information and visible content for visitors.',
      hasPassword: false,
    }),
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.status, 'vivo');
  assert.equal(result.title, 'Terra Fibra');
});

test('uses a Facebook accessible profile heading when the title and description are generic', async () => {
  const url = 'https://facebook.com/terra.vivo.fibra';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => ({
      url: 'https://www.facebook.com/terra.vivo.fibra',
      heading: 'Terra Vivo Fibra',
      html: '<title>(16) Facebook</title><meta property="og:description" content="(16) Facebook">',
      text: 'Public profile content, posts, photos, followers and about information.',
      hasPassword: false,
    }),
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.title, 'Terra Vivo Fibra');
});

test('uses a readable Facebook profile URL slug as a last-resort title', async () => {
  const url = 'https://facebook.com/terra.vivo.fibra';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => ({
      url: 'https://www.facebook.com/terra.vivo.fibra',
      heading: '',
      html: '<title>(16) Facebook</title><meta property="og:description" content="(16) Facebook">',
      text: 'Public profile content, posts, photos, followers and about information.',
      hasPassword: false,
    }),
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.title, 'Terra Vivo Fibra');
});

test('does not invent a Facebook profile title from a numeric profile ID', async () => {
  const url = 'https://facebook.com/profile.php?id=61591122212071';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => ({
      url,
      heading: '',
      html: '<title>(16) Facebook</title><meta property="og:description" content="(16) Facebook">',
      text: 'Public profile content, posts, photos, followers and about information.',
      hasPassword: false,
    }),
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.title, '(16) Facebook');
});

test('reports why opaque-redirect fallback failed when tab reading errors', async () => {
  const result = await checkUrl('https://instagram.com/example_profile', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => { throw new Error('Frame with ID 0 was removed.'); },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.via, 'fetch');
  assert.equal(result.info.tabAttempted, true);
  assert.equal(result.info.tabFallback, 'Tentativa de leitura em aba falhou');
  assert.equal(result.info.tabError, 'Frame with ID 0 was removed.');
});

test('reports a null tab response as a readable fallback failure', async () => {
  const result = await checkUrl('https://www.tiktok.com/@j10002032', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => null,
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.info.tabFallback, 'Tentativa de leitura em aba falhou');
  assert.equal(result.info.tabError, 'Modo aba não retornou dados da página.');
});

test('does not use tab mode when disabled or when network validation blocks the target', async () => {
  let tabReads = 0;
  const base = {
    readTab: async () => {
      tabReads++;
      return { url: 'https://instagram.com/example_profile', html: '<title>Example</title>', text: 'Example' };
    },
    opts: { tabMode: false, timeoutMs: 50 },
  };
  const disabled = await checkUrl('https://instagram.com/example_profile', {
    ...base,
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal(disabled.status, 'indeterminado');
  assert.equal(disabled.info.tabFallback, 'Não iniciada: modo aba desativado');
  assert.equal(tabReads, 0);

  const blocked = await checkUrl('https://instagram.com/example_profile', {
    ...base,
    opts: { tabMode: true, timeoutMs: 50 },
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['10.0.0.1'], sinkhole: true }),
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.ok(blocked.reason.includes('bloqueada por segurança'));
  assert.equal(tabReads, 0);
});
