import assert from 'node:assert/strict';
import test from 'node:test';

import {
  Semaphore, checkUrlWithRetry, runBatch, cancelledResult, timeoutResult, safeHost,
} from '../lib/batchRunner.js';
import { GLOBAL_CONCURRENCY } from '../lib/config.js';

/* ---------- Semaphore ---------- */

test('Semaphore only lets `limit` holders run at once, queueing the rest in order', async () => {
  const sem = new Semaphore(2);
  const order = [];
  const task = async (id) => {
    await sem.acquire();
    order.push(`start:${id}`);
    await Promise.resolve();
    order.push(`end:${id}`);
    sem.release();
  };
  const first = task(1);
  const second = task(2);
  const third = task(3); // deve esperar até que 1 ou 2 libere
  await Promise.resolve();
  assert.ok(order.includes('start:1'));
  assert.ok(order.includes('start:2'));
  assert.ok(!order.includes('start:3'));
  await Promise.all([first, second, third]);
  assert.ok(order.includes('start:3'));
});

/* ---------- helpers puros ---------- */

test('safeHost, timeoutResult e cancelledResult preenchem plataforma/host a partir da URL', () => {
  assert.equal(safeHost('https://www.olx.com.br/item'), 'www.olx.com.br');
  assert.equal(safeHost('não é uma url'), 'não é uma url');

  const timeout = timeoutResult('https://www.olx.com.br/item', new Error('timeout: checkUrl'));
  assert.equal(timeout.status, 'indeterminado');
  assert.equal(timeout.platform, 'olx');
  assert.deepEqual(timeout.tags, ['timeout']);

  const unexpected = timeoutResult('https://example.test/', new Error('boom'));
  assert.deepEqual(unexpected.tags, ['erro']);

  const cancelled = cancelledResult('https://www.tiktok.com/@someone');
  assert.equal(cancelled.status, 'indeterminado');
  assert.equal(cancelled.platform, 'tiktok');
  assert.deepEqual(cancelled.tags, ['cancelado']);
});

/* ---------- checkUrlWithRetry ---------- */

function makeTimeoutOnceCheckUrlFn(finalResult = { status: 'vivo', reason: 'ok', confidence: 'alta', tags: [] }) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error('timeout: checkUrl simulado');
    return finalResult;
  };
  fn.calls = () => calls;
  return fn;
}

test('checkUrlWithRetry repete uma vez após timeout em sites genéricos', async () => {
  const checkUrlFn = makeTimeoutOnceCheckUrlFn();
  const result = await checkUrlWithRetry('https://example.test/', {}, undefined, checkUrlFn);
  assert.equal(result.status, 'vivo');
  assert.equal(checkUrlFn.calls(), 2);
});

test('checkUrlWithRetry NÃO repete timeout para TikTok', async () => {
  const checkUrlFn = makeTimeoutOnceCheckUrlFn();
  await assert.rejects(
    () => checkUrlWithRetry('https://www.tiktok.com/@someone', {}, undefined, checkUrlFn),
  );
  assert.equal(checkUrlFn.calls(), 1);
});

test('checkUrlWithRetry NÃO repete timeout para Facebook Marketplace', async () => {
  const checkUrlFn = makeTimeoutOnceCheckUrlFn();
  await assert.rejects(
    () => checkUrlWithRetry('https://www.facebook.com/marketplace/item/123456/', {}, undefined, checkUrlFn),
  );
  assert.equal(checkUrlFn.calls(), 1);
});

test('checkUrlWithRetry NÃO repete timeout quando o sinal já foi cancelado', async () => {
  const checkUrlFn = makeTimeoutOnceCheckUrlFn();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => checkUrlWithRetry('https://example.test/', {}, controller.signal, checkUrlFn),
  );
  assert.equal(checkUrlFn.calls(), 1);
});

/* ---------- runBatch: concorrência ---------- */

// Mede a concorrência máxima observada em checkUrlFn, liberando todas as chamadas em
// andamento assim que `threshold` é atingido — sem depender de temporizadores reais.
function makeConcurrencyProbe(threshold, result = { status: 'vivo', reason: 'ok', confidence: 'alta', tags: [] }) {
  let active = 0;
  let maxActive = 0;
  let releaseAll;
  const gate = new Promise((resolve) => { releaseAll = resolve; });
  const checkUrlFn = async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    if (active >= threshold) releaseAll();
    await gate;
    active--;
    return result;
  };
  return { checkUrlFn, maxActive: () => maxActive };
}

const noopEnrich = async (res) => res;

test('runBatch nunca excede GLOBAL_CONCURRENCY mesmo com hosts distintos (sem bottleneck por host)', async () => {
  const urls = Array.from({ length: GLOBAL_CONCURRENCY + 4 }, (_, i) => `https://host${i}.example.test/`);
  const probe = makeConcurrencyProbe(GLOBAL_CONCURRENCY);
  const { results } = await runBatch(urls, {}, {}, { checkUrlFn: probe.checkUrlFn, enrichFn: noopEnrich });
  assert.equal(results.size, urls.length);
  assert.equal(probe.maxActive(), GLOBAL_CONCURRENCY);
});

test('runBatch limita a 3 checagens simultâneas para o mesmo host genérico (sem plataforma reconhecida)', async () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://mesmo-host.example.test/pagina-${i}`);
  const probe = makeConcurrencyProbe(3);
  const { results } = await runBatch(urls, {}, {}, { checkUrlFn: probe.checkUrlFn, enrichFn: noopEnrich });
  assert.equal(results.size, urls.length);
  assert.ok(probe.maxActive() <= 3, `esperado <= 3, obtido ${probe.maxActive()}`);
});

test('runBatch limita a 2 checagens simultâneas por plataforma (ex.: OLX)', async () => {
  const urls = Array.from({ length: 5 }, (_, i) => `https://www.olx.com.br/item-${i}-1234567`);
  const probe = makeConcurrencyProbe(2);
  const { results } = await runBatch(urls, {}, {}, { checkUrlFn: probe.checkUrlFn, enrichFn: noopEnrich });
  assert.equal(results.size, urls.length);
  assert.ok(probe.maxActive() <= 2, `esperado <= 2, obtido ${probe.maxActive()}`);
});

test('runBatch limita a 1 checagem simultânea para o Facebook Marketplace', async () => {
  const urls = Array.from({ length: 4 }, (_, i) => `https://www.facebook.com/marketplace/item/${1000 + i}/`);
  const probe = makeConcurrencyProbe(1);
  const { results } = await runBatch(urls, {}, {}, { checkUrlFn: probe.checkUrlFn, enrichFn: noopEnrich });
  assert.equal(results.size, urls.length);
  assert.ok(probe.maxActive() <= 1, `esperado <= 1, obtido ${probe.maxActive()}`);
});

/* ---------- runBatch: fila do TikTok ---------- */

test('runBatch pausa a fila do TikTok após HTTP 429 e marca o restante do lote como pausado', async () => {
  const urls = [
    'https://www.tiktok.com/@primeiro',
    'https://www.tiktok.com/@segundo',
    'https://www.tiktok.com/@terceiro',
  ];
  let calls = 0;
  const checkUrlFn = async () => {
    calls++;
    return {
      status: 'indeterminado',
      platform: 'tiktok',
      httpStatus: 429,
      reason: 'TikTok limitou ou desafiou a consulta (HTTP 429); a fila da plataforma será pausada',
      confidence: 'baixa',
      tags: ['anti-bot'],
    };
  };
  const { results, tiktokPausedCount, tiktokQueuePauseReason } = await runBatch(
    urls, {}, {}, { checkUrlFn, enrichFn: noopEnrich },
  );
  assert.equal(results.size, urls.length);
  // A fila do TikTok é serializada: só a primeira URL chega a chamar checkUrlFn antes da pausa.
  assert.equal(calls, 1);
  assert.equal(tiktokPausedCount, urls.length - 1);
  assert.match(tiktokQueuePauseReason, /HTTP 429/);
  const pausedResults = [...results.values()].filter((r) => r.tags.includes('queue-paused'));
  assert.equal(pausedResults.length, urls.length - 1);
});

/* ---------- runBatch: cancelamento ---------- */

test('runBatch marca URLs restantes como canceladas quando o sinal é abortado', async () => {
  // Mais URLs do que o teto global de concorrência: as que nunca chegam a ocupar uma vaga
  // devem ser marcadas como canceladas sem nunca chamar checkUrlFn.
  const urls = Array.from({ length: GLOBAL_CONCURRENCY + 3 }, (_, i) => `https://outro-host-${i}.example.test/`);
  const controller = new AbortController();
  let started = 0;
  const checkUrlFn = async () => {
    started++;
    controller.abort(); // cancela assim que a 1ª checagem começa
    return { status: 'vivo', reason: 'ok', confidence: 'alta', tags: [] };
  };
  const { results } = await runBatch(
    urls, { signal: controller.signal }, {}, { checkUrlFn, enrichFn: noopEnrich },
  );
  assert.equal(results.size, urls.length);
  const cancelled = [...results.values()].filter((r) => r.tags.includes('cancelado'));
  assert.ok(cancelled.length >= 3, `esperado >= 3 URLs canceladas sem iniciar, obtido ${cancelled.length}`);
  assert.ok(started <= GLOBAL_CONCURRENCY, `checkUrlFn não deveria ter sido chamado mais que ${GLOBAL_CONCURRENCY} vezes, foi ${started}`);
});

/* ---------- runBatch: hooks ---------- */

test('runBatch chama applyHistory, applyManualClassification e os hooks de progresso para cada URL concluída', async () => {
  const urls = ['https://a.example.test/', 'https://b.example.test/'];
  const checkUrlFn = async (url) => ({ url, status: 'vivo', reason: 'ok', confidence: 'alta', tags: [] });
  const historyCalls = [];
  const manualCalls = [];
  let doneCount = 0;
  let activeBalance = 0;
  const resultsSeen = new Set();
  await runBatch(urls, {}, { fakeHist: true }, {
    checkUrlFn,
    enrichFn: noopEnrich,
    applyHistory: (hist, res) => historyCalls.push([hist, res.url]),
    applyManualClassification: (res) => manualCalls.push(res.url),
    onActiveChange: (delta) => { activeBalance += delta; },
    onDone: () => { doneCount++; },
    onResult: (url) => resultsSeen.add(url),
  });
  assert.equal(historyCalls.length, urls.length);
  assert.ok(historyCalls.every(([hist]) => hist.fakeHist === true));
  assert.equal(manualCalls.length, urls.length);
  assert.equal(doneCount, urls.length);
  assert.equal(activeBalance, 0, 'onActiveChange deve ter o mesmo número de +1 e -1');
  assert.equal(resultsSeen.size, urls.length);
});
