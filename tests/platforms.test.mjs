import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUrl } from '../lib/analyzer.js';
import { classifyPage } from '../lib/classification.js';
import { detectPlatform } from '../lib/rules.js';

test('detects Meta Ad Library links separately from Facebook profiles', () => {
  const ad = detectPlatform(new URL('https://www.facebook.com/ads/library/?id=1840012267195550'));
  const profile = detectPlatform(new URL('https://www.facebook.com/example.page'));

  assert.equal(ad?.id, 'facebook');
  assert.equal(ad?.name, 'Meta Ad Library');
  assert.equal(ad?.kind, 'advertisement');
  assert.equal(profile?.kind, 'social');
});

test('classifies a Shopee product as dead when the rendered page says it is out of stock', () => {
  const url = 'https://shopee.com.br/Chip-para-Celular-Vivo-Pr%C3%A9-Sem-recarga-Tr%C3%AAs-tamanhos-i.389340473.22898749670';
  const result = classifyPage({
    url,
    status: null,
    via: 'tab',
    renderedText: 'Quantidade 1 Esgotado OUT OF STOCK',
    platform: detectPlatform(new URL(url)),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Produto esgotado na Shopee');
  assert.equal(result.confidence, 'alta');
  assert.deepEqual(result.tags, ['out-of-stock']);
});

test('does not classify Shopee out-of-stock wording from fetch text or non-product pages as dead', () => {
  const productUrl = 'https://shopee.com.br/product/389340473/22898749670';
  const fetched = classifyPage({
    url: productUrl,
    status: 200,
    via: 'fetch',
    renderedText: 'Produto esgotado',
    platform: detectPlatform(new URL(productUrl)),
  });
  const categoryUrl = 'https://shopee.com.br/search?keyword=esgotado';
  const category = classifyPage({
    url: categoryUrl,
    status: null,
    via: 'tab',
    renderedText: 'Produto esgotado',
    platform: detectPlatform(new URL(categoryUrl)),
  });

  assert.equal(fetched.status, 'indeterminado');
  assert.equal(category.status, 'indeterminado');
});

test('reads Shopee out-of-stock status from the browser even when the API finds the product', async () => {
  const url = 'https://shopee.com.br/Chip-para-Celular-Vivo-Pr%C3%A9-Sem-recarga-Tr%C3%AAs-tamanhos-i.389340473.22898749670';
  let tabRead = false;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['23.197.0.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/api/v4/item/get')) {
        return new Response(JSON.stringify({
          data: { itemid: 22898749670, shopid: 389340473, name: 'Chip Vivo', stock: 5 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('<title>Shopee</title><main>Carregue a página do produto</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    readTab: async (tabUrl) => {
      tabRead = true;
      return { url: tabUrl, html: '<title>Shopee</title>', text: 'Quantidade 1 Esgotado OUT OF STOCK' };
    },
    opts: { tabMode: true },
  });

  assert.equal(tabRead, true);
  assert.equal(result.status, 'morto');
  assert.equal(result.via, 'tab');
  assert.equal(result.reason, 'Produto esgotado na Shopee');
  assert.deepEqual(result.tags, ['out-of-stock']);
});

test('classifies a Shopee API product with zero stock as dead', async () => {
  const url = 'https://shopee.com.br/Chip-para-Celular-Vivo-Pr%C3%A9-Sem-recarga-Tr%C3%AAs-tamanhos-i.389340473.22898749670';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['23.197.0.1'] }),
    fetchFn: async () => new Response(JSON.stringify({
      data: { itemid: 22898749670, shopid: 389340473, name: 'Chip Vivo', stock: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Produto esgotado na Shopee');
  assert.equal(result.via, 'api');
  assert.deepEqual(result.tags, ['out-of-stock']);
});

test('classifies a matching active Meta library ad as alive', () => {
  const id = '1840012267195550';
  const result = classifyPage({
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    status: 200,
    via: 'tab',
    renderedText: `Active Library ID: ${id} Oct 20, 2026 Sponsored Example advertiser`,
    platform: detectPlatform(new URL(`https://www.facebook.com/ads/library/?id=${id}`)),
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Anúncio ativo na Biblioteca de Anúncios da Meta');
});

test('classifies an inactive Meta library ad as a zombie', () => {
  const id = '1840012267195550';
  const result = classifyPage({
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    status: 200,
    via: 'tab',
    renderedText: `Inactive Library ID: ${id} Oct 20, 2026 Sponsored Example advertiser`,
    platform: detectPlatform(new URL(`https://www.facebook.com/ads/library/?id=${id}`)),
  });

  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Anúncio da Meta inativo ou não está sendo veiculado');
});

test('classifies an ad missing from Meta Ad Library as dead', () => {
  const id = '1128685636301799';
  const result = classifyPage({
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    status: 200,
    via: 'tab',
    renderedText: `Ad isn't in the Ad Library. The most common reason is that the ad hasn't received any impressions yet.`,
    platform: detectPlatform(new URL(`https://www.facebook.com/ads/library/?id=${id}`)),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Anúncio não está disponível na Biblioteca de Anúncios da Meta');
  assert.equal(result.confidence, 'média');
});

test('reads Meta Ad Library status from the rendered page after a blocked fetch', async () => {
  const id = '1840012267195550';
  let tabOptions;
  const result = await checkUrl(`https://www.facebook.com/ads/library/?id=${id}`, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['157.240.1.35'] }),
    fetchFn: async () => new Response('Forbidden', { status: 403 }),
    readTab: async (url, options) => {
      tabOptions = options;
      return {
        url,
        html: '<title>Ad Library</title>',
        text: `Active Library ID: ${id} Oct 20, 2026`,
        hasPassword: false,
      };
    },
    opts: { tabMode: true },
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.via, 'tab');
  assert.equal(tabOptions.settle, 8000);
});

test('does not use a different Meta ad card to classify the requested ad', () => {
  const id = '1840012267195550';
  const result = classifyPage({
    url: `https://www.facebook.com/ads/library/?id=${id}`,
    status: 200,
    via: 'tab',
    renderedText: 'Inactive Library ID: 1129430149522876 Sponsored Example advertiser',
    platform: detectPlatform(new URL(`https://www.facebook.com/ads/library/?id=${id}`)),
  });

  assert.equal(result.status, 'indeterminado');
});

test('detects Bluesky platform for bsky.app URLs', () => {
  const p = detectPlatform(new URL('https://bsky.app/profile/alice.bsky.social'));
  assert.equal(p?.id, 'bluesky');
  assert.equal(p?.kind, 'social');
  assert.equal(p?.name, 'Bluesky');
});

test('validates TikTok videos through oEmbed only when the returned ID matches', async () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const calls = [];
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      calls.push(requestUrl);
      if (requestUrl.includes('/oembed?')) {
        return new Response(JSON.stringify({
          type: 'video',
          embed_product_id: '999999999',
          title: 'Unrelated video',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('<title>TikTok</title><p>Page shell</p>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'indeterminado');
  assert.equal(result.via, 'fetch');
  assert.equal(calls.length, 2);
});

test('accepts a TikTok video oEmbed response with the matching video ID', async () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      assert.match(requestUrl, /\/oembed\?/);
      return new Response(JSON.stringify({
        type: 'video',
        embed_product_id: '123456789',
        title: 'Public video',
        author_name: 'Creator',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Vídeo disponível (oEmbed)');
  assert.equal(result.via, 'api');
  assert.equal(result.title, 'Public video');
});

test('does not treat a TikTok oEmbed 404 as conclusive removal', async () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  let pageFetched = false;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/oembed?')) return new Response('Not found', { status: 404 });
      pageFetched = true;
      return new Response('<title>TikTok</title><p>Not found</p>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    },
    opts: { tabMode: false },
  });

  assert.equal(pageFetched, true);
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.via, 'fetch');
});

test('does not call TikTok video oEmbed for photo posts', async () => {
  const url = 'https://www.tiktok.com/@creator/photo/123456789';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: {
          itemStruct: {
            id: '123456789',
            desc: 'Carousel',
            author: { uniqueId: 'creator' },
            imagePost: { images: [{ imageURL: { urlList: ['https://example.test/1.jpg'] } }] },
          },
        },
      },
    },
  };
  let oembedCalled = false;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['104.244.42.1'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.includes('/oembed?')) oembedCalled = true;
      return new Response(
        `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
    opts: { tabMode: false },
  });

  assert.equal(oembedCalled, false);
  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Publicação pública encontrada no TikTok');
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
