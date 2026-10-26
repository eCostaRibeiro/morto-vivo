import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUrl } from '../lib/analyzer.js';
import { classifyPage } from '../lib/classification.js';
import { detectPlatform } from '../lib/rules.js';

test('detects Bluesky platform for bsky.app URLs', () => {
  const p = detectPlatform(new URL('https://bsky.app/profile/alice.bsky.social'));
  assert.equal(p?.id, 'bluesky');
  assert.equal(p?.kind, 'social');
  assert.equal(p?.name, 'Bluesky');
});

test('probes live Bluesky profile via public API', async () => {
  const url = 'https://bsky.app/profile/alice.bsky.social';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/app.bsky.actor.getProfile')) {
        return new Response(JSON.stringify({
          did: 'did:plc:12345',
          handle: 'alice.bsky.social',
          displayName: 'Alice In Wonderland',
          description: 'Bio de teste',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Perfil público encontrado no Bluesky');
  assert.equal(result.title, 'Alice In Wonderland (@alice.bsky.social)');
  assert.equal(result.via, 'api');
});

test('probes removed/nonexistent Bluesky profile as dead link', async () => {
  const url = 'https://bsky.app/profile/naoexiste.bsky.social';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/app.bsky.actor.getProfile')) {
        return new Response(JSON.stringify({
          error: 'AccountNotFound',
          message: 'Profile not found',
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'morto');
  assert.match(result.reason, /Perfil inexistente no Bluesky/);
  assert.equal(result.via, 'api');
});

test('probes suspended or taken down Bluesky profile as dead link', async () => {
  const url = 'https://bsky.app/profile/violador.bsky.social';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/app.bsky.actor.getProfile')) {
        return new Response(JSON.stringify({
          error: 'AccountTakedown',
          message: 'Account has been taken down',
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'morto');
  assert.match(result.reason, /Conta suspensa ou desativada no Bluesky/);
  assert.equal(result.via, 'api');
});

test('probes live Bluesky post via public API', async () => {
  const url = 'https://bsky.app/profile/alice.bsky.social/post/3lbg12345';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/app.bsky.feed.getPostThread')) {
        return new Response(JSON.stringify({
          thread: {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: {
              author: { handle: 'alice.bsky.social', displayName: 'Alice' },
              record: { text: 'Olá Bluesky, post público de teste.' },
            },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Post disponível no Bluesky');
  assert.match(result.title, /Olá Bluesky/);
  assert.equal(result.via, 'api');
});

test('probes deleted Bluesky post as dead link', async () => {
  const url = 'https://bsky.app/profile/alice.bsky.social/post/3lbgdeleted';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/app.bsky.feed.getPostThread')) {
        return new Response(JSON.stringify({
          thread: {
            $type: 'app.bsky.feed.defs#notFoundPost',
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Post removido ou inexistente no Bluesky');
  assert.equal(result.via, 'api');
});

test('does not treat YouTube oEmbed 404 as proof that a channel is dead', async () => {
  const url = 'https://www.youtube.com/@CanalEncerrado123';
  const requests = [];
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['142.250.190.46'] }),
    fetchFn: async (requestUrl) => {
      requests.push(requestUrl);
      return new Response('<title>YouTube</title><main>Conteúdo não conclusivo</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'indeterminado');
  assert.equal(result.via, 'fetch');
  assert.ok(requests.every((requestUrl) => !requestUrl.includes('/oembed?')));
});

test('normalizes x.com hostname to twitter.com for oEmbed request', async () => {
  let requestedUrl = '';
  const url = 'https://x.com/jack/status/20';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      requestedUrl = requestUrl;
      if (requestUrl.includes('publish.twitter.com/oembed')) {
        return new Response(JSON.stringify({
          author_name: 'jack',
          html: '<blockquote>just setting up my twttr</blockquote>',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${requestUrl}`);
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Post disponível (oEmbed)');
  assert.equal(result.title, 'Post de jack');
  assert.equal(result.via, 'api');
  assert.match(requestedUrl, /publish\.twitter\.com\/oembed/);
  // Garante que o parâmetro url enviado ao endpoint contenha twitter.com
  assert.match(requestedUrl, /twitter\.com%2Fjack%2Fstatus%2F20/);
});

test('classifies Instagram page with broken link notice as dead', () => {
  const result = classifyPage({
    url: 'https://www.instagram.com/perfil_removido/',
    status: 200,
    via: 'tab',
    html: '<title>Instagram</title><p>O link que você acessou pode estar quebrado ou a página pode ter sido removida.</p>',
    platform: detectPlatform(new URL('https://www.instagram.com/perfil_removido/')),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Link quebrado / conteúdo removido');
});

test('classifies deleted tweet text in DOM as dead', () => {
  const result = classifyPage({
    url: 'https://x.com/usuario/status/123456789',
    status: 200,
    via: 'tab',
    html: '<title>X</title><article>Este post foi apagado pelo autor.</article>',
    platform: detectPlatform(new URL('https://x.com/usuario/status/123456789')),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Post/tweet apagado ou indisponível');
});

test('uses a platform-neutral reason for shared social dead-link patterns', () => {
  const result = classifyPage({
    url: 'https://x.com/usuario/status/123456789',
    status: 200,
    via: 'tab',
    html: '<title>X</title><article>Profile not found</article>',
    platform: detectPlatform(new URL('https://x.com/usuario/status/123456789')),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Conta ou conteúdo removido/inexistente');
  assert.doesNotMatch(result.reason, /Bluesky/i);
});
