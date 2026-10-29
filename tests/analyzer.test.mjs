import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUrl, markHttpFallback } from '../lib/analyzer.js';
import { classifyPage } from '../lib/classification.js';
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
  assert.deepEqual(result.tags, ['cloudflare']);
});

test('classifies Cloudflare origin errors consistently across common error codes', () => {
  const examples = [
    [521, 'Web server is down'],
    [522, 'Connection timed out'],
    [523, 'Origin is unreachable'],
    [524, 'A timeout occurred'],
    [525, 'SSL handshake failed'],
    [526, 'Invalid SSL certificate'],
    [530, 'Origin connection error'],
    [1016, 'Origin DNS error'],
  ];
  for (const [code, message] of examples) {
    const result = classifyPage({
      url: 'https://example.com/',
      status: null,
      html: `<title>Error ${code}: ${message}</title><p>Cloudflare host error</p>`,
    });
    assert.equal(result.status, 'zumbi', `Cloudflare ${code}`);
    assert.match(result.reason, new RegExp(`Cloudflare ${code}`));
    assert.deepEqual(result.tags, ['cloudflare']);
  }
});

test('does not mistake Cloudflare branding and a price for an origin error', () => {
  const result = classifyPage({
    url: 'https://shop.example/',
    status: 200,
    html: '<title>Loja online</title><main>Produtos e conexão segura.</main><footer>Protected by Cloudflare</footer><p>R$ 530,00</p>',
  });
  assert.equal(result.status, 'vivo');
  assert.doesNotMatch(result.reason, /Cloudflare/i);
  assert.deepEqual(result.tags, []);
});

test('does not mistake a blog explaining Cloudflare 522 for an error page', () => {
  const result = classifyPage({
    url: 'https://example.com/blog/cloudflare-522',
    status: 200,
    html: '<title>O que significa o erro 522 da Cloudflare?</title><article>O código 522 descreve uma conexão entre a Cloudflare e a origem que pode demorar. Este guia explica como investigar a causa, revisar configurações e entender o que o erro significa para operadores de sites.</article>',
  });
  assert.equal(result.status, 'vivo');
  assert.doesNotMatch(result.reason, /Cloudflare/i);
});

test('does not classify a short FAQ about Cloudflare 522 as an origin error', () => {
  const result = classifyPage({
    url: 'https://example.com/faq',
    status: 200,
    html: '<title>Erro 522 Cloudflare: connection timed out</title><p>Este erro significa que a conexão expirou. Consulte nosso FAQ para entender o diagnóstico e os próximos passos.</p>',
  });
  assert.equal(result.status, 'vivo');
  assert.doesNotMatch(result.reason, /Cloudflare/i);
});

test('recognizes a short Cloudflare error page served with HTTP 200 when it has the page signature', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<title>Error 522: Connection timed out</title><p>Cloudflare host error. Ray ID: 123abc</p>',
  });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Timeout no servidor de origem (Cloudflare 522)');
});

test('prefers the Cloudflare code in the title over unrelated numbers in page text', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: null,
    html: '<title>Error 522: Connection timed out</title><p>Cloudflare host error. Reference number 521.</p>',
  });
  assert.equal(result.reason, 'Timeout no servidor de origem (Cloudflare 522)');
});

test('prefers Cloudflare error 1016 from the body over HTTP 530', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 530,
    html: '<title>Cloudflare error</title><p>Error 1016: Origin DNS error</p>',
  });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Erro de DNS na origem (Cloudflare 1016)');
});

test('classifies Cloudflare 1020 access denial as indeterminate', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 403,
    html: '<title>Error 1020: Access denied | Cloudflare</title><p>You do not have access to this website.</p>',
  });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /bloqueio de acesso da Cloudflare \(1020\)/i);
  assert.ok(result.tags.includes('anti-bot'));
});

test('does not treat a blog mentioning Cloudflare 1020 as an access block', () => {
  const result = classifyPage({
    url: 'https://example.com/blog',
    status: 200,
    html: '<title>Cloudflare error 1020: what it means</title><article>This article explains the Cloudflare 1020 access denied error and how a site owner can investigate it.</article>',
  });
  assert.equal(result.status, 'vivo');
  assert.doesNotMatch(result.reason, /Cloudflare|bloqueio de acesso/i);
});

test('tags a Cloudflare HTTP 520 response even without a recognizable error body', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 520,
    html: '<title>Cloudflare</title><p>Unknown error</p>',
  });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.reason, 'Erro desconhecido do servidor de origem (Cloudflare 520)');
  assert.ok(result.tags.includes('cloudflare'));
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

test('does not treat an antivirus block page as a site takedown', async () => {
  const result = await checkUrl('https://coocresb.rodrigobarbosa.com.br/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => new Response(
      '<title>Kaspersky Premium</title><h1>Bloqueado por ordem/decisão</h1>',
      { status: 499, headers: { 'content-type': 'text/html' } },
    ),
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'indeterminado');
  assert.equal(result.httpStatus, 499);
  assert.equal(result.confidence, 'baixa');
  assert.ok(result.tags.includes('security-interstitial'));
  assert.ok(!result.tags.includes('takedown'));
  assert.match(result.reason, /software de segurança/i);
});

test('does not treat ordinary antivirus mentions as security block interstitials', () => {
  const result = classifyPage({
    url: 'https://example.com/security-guide',
    status: 200,
    html: '<title>Kaspersky Premium: review and setup guide</title><article>How to configure security protection.</article>',
  });

  assert.equal(result.status, 'vivo');
  assert.ok(!result.tags.includes('security-interstitial'));
});

test('does not classify a large legitimate article as a phishing warning', () => {
  const article = `This article discusses phishing detection, warning messages, and deceptive sites. ${'More background and research context. '.repeat(700)}`;
  const result = classifyPage({
    url: 'https://example.com/security-article',
    status: 200,
    html: `<title>Research article about phishing warnings</title><article>${article}</article>`,
  });
  assert.equal(result.status, 'vivo');
  assert.doesNotMatch(result.reason, /phishing/i);
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

test('applies literal custom rules to generic page text and marks their result', () => {
  const result = classifyPage({
    url: 'https://example.com/item',
    status: 200,
    html: '<title>Produto</title><p>Este anúncio foi encerrado</p>',
    customRules: [{ status: 'morto', term: 'anuncio foi encerrado' }],
  });
  assert.equal(result.status, 'morto');
  assert.match(result.reason, /Regra personalizada/);
  assert.deepEqual(result.tags, ['custom']);
});

test('passes custom rules through the URL analysis pipeline', async () => {
  const result = await checkUrl('https://example.com/item', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => new Response(
      '<title>Product</title><p>Current listing is unavailable</p>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
    opts: { customRules: [{ status: 'morto', term: 'current listing is unavailable' }] },
  });
  assert.equal(result.status, 'morto');
  assert.deepEqual(result.tags, ['custom']);
});

test('custom rules do not override anti-bot, login, or explicit HTTP evidence', () => {
  const customRules = [{ status: 'vivo', term: 'produto disponível' }];
  const challenge = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<title>Just a moment</title><p>Produto disponível</p>',
    customRules,
  });
  assert.equal(challenge.status, 'indeterminado');
  assert.ok(!challenge.tags.includes('custom'));

  const loginUrl = 'https://www.instagram.com/example/';
  const login = classifyPage({
    url: loginUrl,
    status: 200,
    html: '<title>Instagram</title><p>Log in to continue. Produto disponível</p>',
    platform: detectPlatform(new URL(loginUrl)),
    customRules,
  });
  assert.equal(login.status, 'indeterminado');
  assert.ok(!login.tags.includes('custom'));

  const notFound = classifyPage({
    url: 'https://example.com/',
    status: 404,
    html: '<p>Produto disponível</p>',
    customRules,
  });
  assert.equal(notFound.status, 'morto');
  assert.match(notFound.reason, /HTTP 404/);
  assert.ok(!notFound.tags.includes('custom'));
});

test('login banners and hidden password controls do not block normal public-profile classification', () => {
  const url = 'https://www.instagram.com/example/';
  const platform = detectPlatform(new URL(url));
  for (const hasPassword of [false, true]) {
    const result = classifyPage({
      url,
      finalUrl: url,
      status: 200,
      via: 'tab',
      html: '<title>Example public profile</title>',
      renderedText: 'Log in or sign up to see more. Public profile with posts and photos.',
      hasPassword,
      platform,
    });
    assert.equal(result.status, 'vivo');
  }
});

test('a login wall still blocks a matching custom rule without changing default classification', () => {
  const url = 'https://www.instagram.com/example/';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: 200,
    via: 'tab',
    html: '<title>Example public profile</title>',
    renderedText: 'Log in or sign up to see more.',
    customRules: [{ status: 'morto', term: 'example public profile' }],
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /barreira de login/i);
  assert.ok(!result.tags.includes('custom'));
});

test('custom rules match whole terms rather than arbitrary substrings', () => {
  const options = {
    url: 'https://example.com/',
    status: 200,
    customRules: [{ status: 'morto', term: 'morto' }],
  };
  const partial = classifyPage({ ...options, html: '<title>Mortorista</title>' });
  const whole = classifyPage({ ...options, html: '<title>Conteúdo morto</title>' });
  assert.equal(partial.status, 'vivo');
  assert.equal(whole.status, 'morto');
});

test('custom rules match normalized multi-line terms in footer text beyond the initial excerpt', () => {
  const term = 'Copyright © 1999-2026 GoDaddy, LLC. Todos os direitos reservados. Aviso de isenção de responsabilidade: as referências a qualquer empresa, produto ou serviço neste Site não são controladas pela GoDaddy.com LLC e não constituem ou implicam sua associação a esses terceiros ou seu endosso deles. Política de Privacidade';
  const pageText = `${'Conteúdo público da página com informações úteis. '.repeat(160)}\n${term}`;
  const result = classifyPage({
    url: 'https://betfusion.vip/lander',
    status: 200,
    html: `<title>Betfusion</title><main>${pageText}</main>`,
    customRules: [{
      status: 'morto',
      term: 'Copyright © 1999-2026 GoDaddy, LLC. Todos os direitos reservados.\nAviso de isenção de responsabilidade: as referências a qualquer empresa, produto ou serviço neste Site não são controladas pela GoDaddy.com LLC e não constituem ou implicam sua associação a esses terceiros ou seu endosso deles.\n[Política de Privacidade](https://betfusion.vip/lander#!)',
    }],
  });
  assert.equal(result.status, 'morto');
  assert.ok(result.tags.includes('custom'));
});

test('classifies an HTTP 200 non-text response as an available download', async () => {
  const result = await checkUrl('https://example.com/app.apk', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
      status: 200,
      headers: { 'content-type': 'application/vnd.android.package-archive' },
    }),
  });
  assert.equal(result.status, 'vivo');
  assert.match(result.reason, /arquivo para download/i);
  assert.equal(result.info.contentType, 'application/vnd.android.package-archive');
  assert.ok(result.tags.includes('download'));
});

test('keeps cross-domain redirects indeterminate with an explicit destination warning', () => {
  const result = classifyPage({
    url: 'https://old-example.com/item',
    finalUrl: 'https://destination.example.net/',
    status: 200,
    html: '<title>Destination</title><p>Available</p>',
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.confidence, 'média');
  assert.ok(result.tags.includes('redirect-externo'));
  assert.match(result.reason, /destination\.example\.net/);
  assert.match(result.reason, /confirme o destino e o conteúdo/);
});

test('follows a validated cross-domain meta refresh and keeps its destination indeterminate', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://oldsite.com/landing', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requestedUrls.push(requestUrl);
      if (requestUrl === 'https://oldsite.com/landing') {
        return new Response(
          '<html><head><meta http-equiv="refresh" content="0;url=https://brand.com/"></head><body></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response('<title>Brand</title><main>Official website</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });

  assert.deepEqual(requestedUrls, ['https://oldsite.com/landing', 'https://brand.com/']);
  assert.equal(result.finalUrl, 'https://brand.com/');
  assert.equal(result.redirected, true);
  assert.equal(result.status, 'indeterminado');
  assert.ok(result.tags.includes('redirect-externo'));
});

test('does not follow a meta refresh whose delay exceeds five seconds', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://oldsite.com/dashboard', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requestedUrls.push(requestUrl);
      return new Response(
        '<html><head><title>Admin Dashboard</title><meta http-equiv="refresh" content="3600;url=/logout"></head><body><main>Active account dashboard and recent activity.</main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });

  assert.deepEqual(requestedUrls, ['https://oldsite.com/dashboard']);
  assert.equal(result.finalUrl, 'https://oldsite.com/dashboard');
  assert.equal(result.status, 'vivo');
});

test('reports NXDOMAIN from a meta refresh as an indeterminate destination failure', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://oldsite.com/landing', {
    doh: async (hostname) => hostname === 'oldsite.com'
      ? { rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }
      : { rcode: 3, nxdomain: true, hasAddress: false, addresses: [] },
    fetchFn: async (requestUrl) => {
      requestedUrls.push(requestUrl);
      return new Response(
        '<meta http-equiv="refresh" content="0;url=https://missing-phish-987654321.com/">',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });

  assert.deepEqual(requestedUrls, ['https://oldsite.com/landing']);
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.confidence, 'média');
  assert.deepEqual(result.tags, ['redirect-externo', 'dns']);
  assert.match(result.reason, /domínio inexistente \(missing-phish-987654321\.com\)/i);
  assert.match(result.reason, /URL original respondeu/);
});

test('blocks a meta refresh to a private destination before requesting it', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://oldsite.com/landing', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requestedUrls.push(requestUrl);
      return new Response(
        '<meta http-equiv="refresh" content="0;url=http://127.0.0.1/admin">',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });

  assert.deepEqual(requestedUrls, ['https://oldsite.com/landing']);
  assert.equal(result.status, 'indeterminado');
  assert.deepEqual(result.tags, ['seguranca']);
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

test('classifies TikTok account-not-found interstitials as unavailable profiles, not takedowns', () => {
  const url = 'https://www.tiktok.com/@www.picpay_bankingbrazil';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedText: "Couldn't find this account. Looking for videos? Try browsing our trending creators.",
  });
  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'TikTok informa que não encontrou esta conta; o perfil não está disponível neste endereço');
  assert.equal(result.confidence, 'média');
  assert.deepEqual(result.tags, ['account-unavailable']);
});

test('classifies a localized TikTok account-not-found message as unavailable', () => {
  const url = 'https://www.tiktok.com/@simbrasil.oficial';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedText: 'Não foi possível localizar esta conta.',
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.confidence, 'média');
  assert.deepEqual(result.tags, ['account-unavailable']);
});

test('classifies the localized TikTok account-not-found heading as unavailable', () => {
  const url = 'https://www.tiktok.com/@missing_profile';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Não foi possível localizar esta conta',
    renderedText: 'Procurando vídeos? Experimente navegar por nossos criadores, hashtags e sons populares.',
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.confidence, 'média');
  assert.deepEqual(result.tags, ['account-unavailable']);
});

test('classifies a TikTok account-not-found message with surrounding page text as unavailable', () => {
  const url = 'https://www.tiktok.com/@missing_profile';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedText: `Couldn't find this account. ${'TikTok navigation and footer content. '.repeat(30)}`,
  });

  assert.equal(result.status, 'morto');
  assert.deepEqual(result.tags, ['account-unavailable']);
});

test('finds a TikTok account-not-found message after long navigation text', () => {
  const url = 'https://www.tiktok.com/@missing_profile';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Para você',
    renderedText: `${'TikTok navigation and recommendations. '.repeat(60)}Couldn't find this account.`,
  });

  assert.equal(result.status, 'morto');
  assert.deepEqual(result.tags, ['account-unavailable']);
});

test('does not apply the TikTok profile-specific account-unavailable tag to video pages', () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedText: "Couldn't find this account",
  });
  assert.equal(result.status, 'morto');
  assert.doesNotMatch(result.tags.join(' '), /account-unavailable|takedown/);
  assert.notEqual(result.reason, 'TikTok informa que não encontrou esta conta; o perfil não está disponível neste endereço');
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

test('does not classify challenge phrases in a rendered TikTok profile bio as anti-bot', () => {
  const url = 'https://www.tiktok.com/@creator';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Creator',
    renderedText: 'Creator profile. Verify to continue and claim your prize. '.repeat(20),
  });

  assert.equal(result.status, 'vivo');
  assert.notEqual(result.reason, 'TikTok apresentou uma tela de espera ou verificação anti-bot');
  assert.ok(!result.tags.includes('anti-bot'));
});

test('does not treat account-unavailable text in a TikTok profile bio as proof the account is missing', () => {
  const url = 'https://www.tiktok.com/@creator';
  const result = classifyPage({
    url,
    finalUrl: url,
    status: null,
    html: '<title>TikTok - Make Your Day</title>',
    platform: detectPlatform(new URL(url)),
    via: 'tab',
    renderedHeading: 'Creator',
    renderedText: "Creator profile. Couldn't find this account? Verify to continue and claim your prize.",
  });

  assert.equal(result.status, 'vivo');
  assert.ok(!result.tags.includes('account-unavailable'));
});

test('stops TikTok probing after an HTTP 429 response', async () => {
  const calls = [];
  const result = await checkUrl('https://www.tiktok.com/@creator/video/123456789', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['8.8.8.8'] }),
    fetchFn: async (url) => {
      calls.push(url);
      return new Response('Too many requests', { status: 429 });
    },
    opts: { tabMode: false },
  });

  assert.equal(result.status, 'indeterminado');
  assert.equal(result.httpStatus, 429);
  assert.equal(result.via, 'api');
  assert.ok(result.tags.includes('anti-bot'));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /tiktok\.com\/oembed/);
});

test('keeps generic TikTok captcha pages indeterminate without using them as a batch-stop signal', () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const result = classifyPage({
    url,
    status: 403,
    html: '<title>Attention required</title><p>Request blocked for this browser.</p>',
    platform: detectPlatform(new URL(url)),
  });
  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /Bloqueio anti-bot\/captcha/);
  assert.ok(!result.tags.includes('anti-bot'));
});

test('marks explicit TikTok CAPTCHA text as a batch-stop challenge', () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  const result = classifyPage({
    url,
    status: 200,
    html: '<title>TikTok</title><p>Captcha verification required.</p>',
    platform: detectPlatform(new URL(url)),
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

test('classifies a TikTok photo post from matching public photo state', () => {
  const url = 'https://www.tiktok.com/@angl.o5/photo/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: {
          itemStruct: {
            id: '7673282406937333000',
            desc: 'Carrossel público de teste',
            author: { uniqueId: 'angl.o5', nickname: 'Angel' },
            imagePost: { images: [{ imageURL: { urlList: ['https://example.test/1.jpg'] } }] },
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
  assert.equal(result.reason, 'Publicação pública encontrada no TikTok');
  assert.equal(result.meta.og['og:title'], 'Angel: Carrossel público de teste');
});

test('uses the canonical TikTok destination when classifying a redirected short link', () => {
  const url = 'https://vm.tiktok.com/short-code/';
  const finalUrl = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        statusCode: 0,
        itemInfo: {
          itemStruct: {
            id: '7673282406937333000',
            desc: 'Vídeo alcançado por link curto',
            author: { uniqueId: 'angl.o5' },
          },
        },
      },
    },
  };
  const result = classifyPage({
    url,
    finalUrl,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });

  assert.equal(result.status, 'vivo');
  assert.equal(result.reason, 'Vídeo público encontrado no TikTok');
});

test('classifies a TikTok photo post as removed from the explicit deleted state', () => {
  const url = 'https://www.tiktok.com/@angl.o5/photo/7673282406937333000';
  const state = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { statusCode: 10204, statusMsg: 'status_deleted' },
    },
  };
  const result = classifyPage({
    url,
    status: 200,
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(state)}</script>`,
    platform: detectPlatform(new URL(url)),
  });

  assert.equal(result.status, 'morto');
  assert.equal(result.reason, 'Publicação removida segundo o estado público do TikTok');
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
      ? new Response(JSON.stringify({ type: 'video', embed_product_id: '9999999999999999999' }), {
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

test('keeps an ambiguous TikTok HTTP 404 indeterminate without explicit deleted state', () => {
  const url = 'https://www.tiktok.com/@angl.o5/video/7673282406937333000';
  const result = classifyPage({
    url,
    status: 404,
    html: '<title>TikTok</title><p>Not found</p>',
    platform: detectPlatform(new URL(url)),
  });

  assert.equal(result.status, 'indeterminado');
  assert.match(result.reason, /TikTok respondeu HTTP 404/);
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

test('classifies the GoDaddy parked landing page for betfusion.vip as dead', () => {
  const result = classifyPage({
    url: 'https://betfusion.vip/',
    status: 200,
    html: `
      <title>betfusion.vip</title>
      <p>betfusion.vip está hospedado gratuitamente, cortesia da GoDaddy.com.</p>
      <button>Adquira este domínio</button>
      <p>Copyright © 1999-2026 GoDaddy, LLC. Todos os direitos reservados.</p>
    `,
  });
  assert.equal(result.status, 'morto');
  assert.match(result.reason, /domínio estacionado pela godaddy/i);
  assert.ok(result.tags.includes('parked'));
  assert.ok(!result.tags.includes('takedown'));
});

test('recognizes the GoDaddy parking lander HTML shell', () => {
  const result = classifyPage({
    url: 'https://betfusion.vip/lander',
    status: 200,
    html: '<!doctype html><html><head><script>window.LANDER_SYSTEM="PW"</script><script defer src="https://img1.wsimg.com/parking-lander/static/js/main.js"></script></head><body><div id="root"></div></body></html>',
  });
  assert.equal(result.status, 'morto');
  assert.match(result.reason, /godaddy/i);
  assert.ok(result.tags.includes('parked'));
  assert.ok(!result.tags.includes('takedown'));
});

test('classifies concise domain-sale pages from known parking providers as parked, not takedown', () => {
  const examples = [
    ['Sedo', '<title>Example domain is for sale</title><p>Make an offer for this domain.</p><script src="https://sedoparking.com/lander.js"></script>'],
    ['Afternic', '<title>Buy this domain</title><p>This domain may be for sale.</p><footer>Listed with Afternic</footer>'],
    ['ParkingCrew', '<title>Domain parking</title><p>This domain is parked. Purchase this domain.</p><img src="https://parkingcrew.net/logo.png">'],
  ];
  for (const [provider, html] of examples) {
    const result = classifyPage({ url: 'https://example.com/lander', status: 200, html });
    assert.equal(result.status, 'morto', provider);
    assert.match(result.reason, /domínio (estacionado|anunciado para venda)/i);
    assert.equal(result.confidence, 'alta');
    assert.ok(result.tags.includes('parked'));
    assert.ok(!result.tags.includes('takedown'));
  }
});

test('does not treat registrar or marketplace names as parking-provider evidence', () => {
  const examples = [
    '<title>What does "domain is parked" mean?</title><article>Namecheap provides domain registration and DNS. This guide explains parked-domain notices.</article>',
    '<title>What does "domain is parked" mean?</title><article>Dan.com is a marketplace for domain names. This guide explains parked-domain notices.</article>',
    '<title>What does "domain is parked" mean?</title><article>Namecheap is a domain registrar. This guide explains that parked domains may show this notice.</article>',
  ];
  for (const html of examples) {
    const result = classifyPage({ url: 'https://example.com/article', status: 200, html });
    assert.equal(result.status, 'vivo');
    assert.ok(!result.tags.includes('parked'));
    assert.ok(!result.tags.includes('takedown'));
  }
});

test('marks a short domain-sale call to action as parked with medium confidence', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<title>Buy this domain</title><main>Purchase this domain today.</main>',
  });
  assert.equal(result.status, 'morto');
  assert.equal(result.confidence, 'média');
  assert.ok(result.tags.includes('parked'));
  assert.ok(!result.tags.includes('takedown'));
});

test('does not classify an article discussing domain sales or provider names as parked', () => {
  for (const html of [
    '<title>What does "this domain is for sale" mean?</title><article>This guide explains how to buy a domain and what to check before making an offer.</article>',
    '<title>Sedo domain management guide</title><article>How to connect your domain and configure DNS.</article>',
    '<title>What does "this domain is for sale" mean?</title><article>Sedo explains how to buy a domain and configure DNS.</article>',
  ]) {
    const result = classifyPage({ url: 'https://example.com/guide', status: 200, html });
    assert.equal(result.status, 'vivo');
  }
});

test('follows a same-origin JavaScript redirect to detect the GoDaddy parking page', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://betfusion.vip/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (url) => {
      requestedUrls.push(String(url));
      if (String(url) === 'https://betfusion.vip/') {
        return new Response(
          '<html><head><script>window.onload=function(){window.location.href="/lander"}</script></head><body></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response(
        '<!doctype html><html><head><script>window.LANDER_SYSTEM="PW"</script><script defer src="https://img1.wsimg.com/parking-lander/static/js/main.js"></script></head><body><div id="root"></div></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });
  assert.deepEqual(requestedUrls, ['https://betfusion.vip/', 'https://betfusion.vip/lander']);
  assert.equal(result.status, 'morto');
  assert.equal(result.finalUrl, 'https://betfusion.vip/lander');
  assert.match(result.reason, /godaddy/i);
});

test('follows a same-origin lander redirect for another explicit parking provider', async () => {
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (url) => new Response(
      String(url).endsWith('/')
        ? '<html><script>window.location.href="/lander"</script></html>'
        : '<title>This domain is for sale</title><p>Make an offer for this domain.</p><footer>Afternic</footer>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  });
  assert.equal(result.finalUrl, 'https://example.com/lander');
  assert.equal(result.status, 'morto');
  assert.match(result.reason, /provedor de parking/i);
});

test('does not follow a cross-origin JavaScript redirect', async () => {
  const requestedUrls = [];
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (url) => {
      requestedUrls.push(String(url));
      return new Response(
        '<html><script>window.location.href="//other.example/path"</script></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
  });
  assert.deepEqual(requestedUrls, ['https://example.com/']);
  assert.notEqual(result.finalUrl, 'https://other.example/path');
});

test('does not classify GoDaddy copyright text alone as a dead domain', () => {
  const result = classifyPage({
    url: 'https://example.com/',
    status: 200,
    html: '<title>Example shop</title><main>Products available now.</main><footer>Copyright GoDaddy, LLC.</footer>',
  });
  assert.equal(result.status, 'vivo');
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
  assert.match(result.reason, /^Sem resposta \(timeout\)/);
  assert.match(result.reason, /tentativa HTTP também falhou/);
});

test('retries HTTPS transport failures over guarded HTTP and marks the result as lower confidence', async () => {
  const requests = [];
  const result = await checkUrl('https://example.com/gone', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requests.push(requestUrl);
      if (requestUrl.startsWith('https:')) throw new TypeError('TLS connection failed');
      return new Response('<title>Not found</title>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.deepEqual(requests, ['https://example.com/gone', 'http://example.com/gone']);
  assert.equal(result.status, 'morto');
  assert.equal(result.httpStatus, 404);
  assert.equal(result.finalUrl, 'http://example.com/gone');
  assert.equal(result.confidence, 'média');
  assert.ok(result.tags.includes('http-fallback'));
  assert.match(result.reason, /resultado obtido via HTTP após falha HTTPS/);
  assert.equal(result.info.httpFallback, 'Tentativa HTTP usada após falha da conexão HTTPS');
});

test('classifies an HTTP 409 response after an HTTPS protocol failure as a zombie response', async () => {
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      if (requestUrl.startsWith('https:')) throw new TypeError('ERR_SSL_VERSION_OR_CIPHER_MISMATCH');
      return new Response('<title>Conflict</title>', {
        status: 409,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(result.status, 'zumbi');
  assert.equal(result.httpStatus, 409);
  assert.ok(result.tags.includes('http-fallback'));
});

test('keeps a transport failure with public DNS indeterminate when HTTP also fails', async () => {
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => { throw new TypeError('ERR_SSL_VERSION_OR_CIPHER_MISMATCH'); },
  });
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.confidence, 'baixa');
  assert.ok(result.tags.includes('rede'));
  assert.match(result.reason, /DNS resolve para endereço público/);
  assert.match(result.reason, /tentativa HTTP também falhou/);
});

test('caps HTTP fallback confidence without raising a low-confidence result', () => {
  const low = markHttpFallback({ status: 'indeterminado', reason: 'DNS incerto', confidence: 'baixa', tags: ['dns'] });
  assert.equal(low.confidence, 'baixa');
  assert.ok(low.tags.includes('http-fallback'));

  const high = markHttpFallback({ status: 'morto', reason: 'HTTP 404', confidence: 'alta', tags: [] });
  assert.equal(high.confidence, 'média');
});

test('tries guarded HTTP after an opaque HTTPS redirect without following the hidden target', async () => {
  const requests = [];
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requests.push(requestUrl);
      if (requestUrl.startsWith('https:')) {
        return { type: 'opaqueredirect', status: 0, headers: new Headers() };
      }
      return new Response('<title>Example site</title><main>Public content</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.deepEqual(requests, ['https://example.com/', 'http://example.com/']);
  assert.equal(result.status, 'vivo');
  assert.equal(result.confidence, 'média');
  assert.ok(result.tags.includes('http-fallback'));
});

test('uses the explicitly enabled guarded tab mode for generic opaque redirects', async () => {
  let tabReads = 0;
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async (url) => {
      tabReads++;
      return {
        url,
        html: '<title>Example shop</title><main>Products available now</main>',
        text: 'Products available now',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(tabReads, 1);
  assert.equal(result.status, 'vivo');
  assert.equal(result.via, 'tab');
  assert.equal(result.info.tabFallback, 'DOM da página lido em aba');
});

test('does not open generic opaque redirects in a tab unless tab mode is enabled', async () => {
  let tabReads = 0;
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async () => {
      tabReads++;
      return { url: 'https://example.com/', html: '<title>Example</title>', text: 'Example' };
    },
    opts: { tabMode: false, timeoutMs: 50 },
  });
  assert.equal(tabReads, 0);
  assert.equal(result.status, 'indeterminado');
});

test('retries over HTTP after an HTTPS timeout when the analysis was not cancelled', async () => {
  const requests = [];
  const timeout = new Error('request timed out');
  timeout.name = 'AbortError';
  const result = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async (requestUrl) => {
      requests.push(requestUrl);
      if (requestUrl.startsWith('https:')) throw timeout;
      return new Response('<title>Example shop</title><main>Products available</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.deepEqual(requests, ['https://example.com/', 'http://example.com/']);
  assert.equal(result.status, 'vivo');
  assert.equal(result.confidence, 'média');
  assert.ok(result.tags.includes('http-fallback'));
});

test('does not retry HTTP when HTTPS succeeds or network safety rejects the destination', async () => {
  let requestCount = 0;
  const successfulHttps = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => {
      requestCount++;
      return new Response('<title>Example shop</title><main>Products available</main>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal(successfulHttps.status, 'vivo');
  assert.equal(requestCount, 1);
  assert.equal(successfulHttps.info.httpFallback, undefined);

  requestCount = 0;
  const rejectedDestination = await checkUrl('https://example.com/', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['10.0.0.1'] }),
    fetchFn: async () => {
      requestCount++;
      throw new TypeError('must not be called');
    },
  });
  assert.equal(rejectedDestination.status, 'indeterminado');
  assert.equal(requestCount, 0);
  assert.equal(rejectedDestination.info.httpFallback, undefined);
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
  let tabOptions;
  const result = await checkUrl('https://instagram.com/example_profile', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => { throw new TypeError('Failed to fetch'); },
    readTab: async (url, options) => {
      tabReads++;
      tabOptions = options;
      return {
        url,
        html: '<title>Example Profile • Instagram</title>',
        text: 'Example Profile public account content',
        hasPassword: false,
      };
    },
    opts: {
      tabMode: true,
      timeoutMs: 50,
      customRules: [{ status: 'morto', term: 'profile unavailable' }],
    },
  });
  assert.equal(tabReads, 1);
  assert.equal(result.via, 'tab');
  assert.equal(result.status, 'vivo');
  assert.equal(tabOptions.settle, 7000);
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
  assert.equal(tabOptions.tiktokWait, 45000);
  assert.equal(tabOptions.reuseTab, true);
});

test('uses the slower reusable tab flow for TikTok video fallback', async () => {
  const url = 'https://www.tiktok.com/@creator/video/123456789';
  let tabOptions;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => ({ type: 'opaqueredirect', status: 0, headers: new Headers() }),
    readTab: async (_url, options) => {
      tabOptions = options;
      return {
        url,
        html: '<title>TikTok</title>',
        text: 'Video unavailable',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });
  assert.equal(result.via, 'tab');
  assert.equal(tabOptions.waitForTikTokProfile, undefined);
  assert.equal(tabOptions.settle, 8000);
  assert.equal(tabOptions.reuseTab, true);
});

test('falls back to the reusable TikTok tab for an indeterminate profile fetch', async () => {
  const url = 'https://www.tiktok.com/@creator';
  let tabReads = 0;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => new Response('<title>TikTok</title><p>Temporary page shell</p>', {
      status: 403,
      headers: { 'content-type': 'text/html' },
    }),
    readTab: async (_url, options) => {
      tabReads++;
      assert.equal(options.reuseTab, true);
      assert.equal(options.waitForTikTokProfile, true);
      assert.equal(options.tiktokWait, 45000);
      return {
        url,
        html: '<title>TikTok</title>',
        text: "Couldn't find this account",
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });

  assert.equal(tabReads, 1);
  assert.equal(result.via, 'tab');
  assert.equal(result.status, 'morto');
});

test('opens TikTok profiles directly in tab mode without relying on the initial fetch', async () => {
  const url = 'https://www.tiktok.com/@creator';
  let tabReads = 0;
  let fetchCalls = 0;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => {
      fetchCalls++;
      return new Response(
      "<title>TikTok</title><p>Couldn't find this account</p>",
      { status: 200, headers: { 'content-type': 'text/html' } },
      );
    },
    readTab: async (_url, options) => {
      tabReads++;
      assert.equal(options.reuseTab, true);
      assert.equal(options.waitForTikTokProfile, true);
      assert.equal(options.tiktokWait, 45000);
      return {
        url,
        heading: 'Creator',
        html: '<title>TikTok</title>',
        text: 'Creator profile and public videos',
        hasPassword: false,
      };
    },
    opts: { tabMode: true, timeoutMs: 50 },
  });

  assert.equal(tabReads, 1);
  assert.equal(fetchCalls, 0);
  assert.equal(result.via, 'tab');
  assert.equal(result.status, 'vivo');
});

test('does not fall back to fetch classification when TikTok tab verification fails', async () => {
  const url = 'https://www.tiktok.com/@creator';
  let fetchCalls = 0;
  const result = await checkUrl(url, {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => {
      fetchCalls++;
      return new Response("<title>TikTok</title>", {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    readTab: async () => { throw new Error('Debugger unavailable'); },
    opts: { tabMode: true, timeoutMs: 50 },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.reason, 'Falha ao confirmar o perfil TikTok no modo aba');
  assert.equal(result.info.tabError, 'Debugger unavailable');
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

  const tikTokDisabled = await checkUrl('https://www.tiktok.com/@creator', {
    doh: async () => ({ rcode: 0, hasAddress: true, addresses: ['93.184.216.34'] }),
    fetchFn: async () => new Response('<title>TikTok</title>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    readTab: async () => {
      tabReads++;
      return { url: 'https://www.tiktok.com/@creator', html: '', text: '' };
    },
    opts: { tabMode: false, timeoutMs: 50 },
  });
  assert.equal(tikTokDisabled.status, 'indeterminado');
  assert.equal(tikTokDisabled.info.tabAttempted, false);
  assert.equal(tikTokDisabled.info.tabFallback, 'Não iniciada: modo aba desativado');
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
