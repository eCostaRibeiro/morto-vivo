import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPage } from '../lib/classification.js';
import { detectPlatform } from '../lib/rules.js';
import { createTikTokQueue, shouldPauseTikTokQueue } from '../lib/tiktokQueue.js';

test('only pauses the TikTok queue for explicit rate limits or TikTok challenges', () => {
  assert.equal(shouldPauseTikTokQueue({
    platform: 'tiktok',
    status: 'indeterminado',
    reason: 'Sem sinal conclusivo de conteúdo público',
    tags: ['anti-bot'],
  }), false);
  assert.equal(shouldPauseTikTokQueue({
    platform: 'tiktok',
    httpStatus: 429,
    reason: 'TikTok limitou ou desafiou a consulta',
  }), true);
  assert.equal(shouldPauseTikTokQueue({
    platform: 'tiktok',
    reason: 'TikTok apresentou uma tela de espera ou verificação anti-bot',
    tags: ['anti-bot'],
  }), false);
  assert.equal(shouldPauseTikTokQueue({
    platform: 'tiktok',
    httpStatus: 403,
    reason: 'TikTok limitou ou desafiou a consulta (HTTP 403); a fila da plataforma será pausada',
    tags: ['anti-bot'],
  }), true);
  assert.equal(shouldPauseTikTokQueue({
    platform: 'facebook',
    httpStatus: 429,
  }), false);
});

test('a verification phrase in a profile bio does not pause the following TikTok check', async () => {
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
  assert.equal(shouldPauseTikTokQueue({ ...result, platform: 'tiktok' }), false);

  const queue = createTikTokQueue(0);
  const first = await queue.acquire();
  first.release();
  const next = await queue.acquire();
  assert.equal(next.proceed, true);
  next.release();
});

test('serializes TikTok work and pauses queued checks after a challenge', async () => {
  const queue = createTikTokQueue(0);
  const first = await queue.acquire();
  const secondPending = queue.acquire();
  let secondAcquired = false;
  secondPending.then(() => { secondAcquired = true; });
  await Promise.resolve();
  assert.equal(secondAcquired, false);

  queue.pause('desafio anti-bot detectado');
  first.release();
  const second = await secondPending;
  assert.equal(second.proceed, false);
  assert.equal(second.reason, 'desafio anti-bot detectado');
  second.release();
});

test('releases the TikTok queue when an interval wait is cancelled', async () => {
  const queue = createTikTokQueue(20);
  const first = await queue.acquire();
  first.release();

  const controller = new AbortController();
  const waiting = queue.acquire(controller.signal);
  controller.abort();
  const cancelled = await waiting;
  assert.equal(cancelled.proceed, false);
  cancelled.release();

  const next = await queue.acquire();
  assert.equal(next.proceed, true);
  next.release();
});

test('cancels a TikTok check waiting behind another check without breaking serialization', async () => {
  const queue = createTikTokQueue(0);
  const first = await queue.acquire();
  const controller = new AbortController();
  const waiting = queue.acquire(controller.signal);
  controller.abort();

  const cancelled = await waiting;
  assert.equal(cancelled.proceed, false);
  assert.equal(cancelled.reason, 'análise cancelada');

  let thirdAcquired = false;
  const thirdPending = queue.acquire().then((turn) => {
    thirdAcquired = true;
    return turn;
  });
  await Promise.resolve();
  assert.equal(thirdAcquired, false);

  first.release();
  const third = await thirdPending;
  assert.equal(third.proceed, true);
  third.release();
});
