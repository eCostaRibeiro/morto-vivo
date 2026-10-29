// Orquestração de um lote de URLs: concorrência global, semáforos por host/plataforma,
// a fila serializada do TikTok, retry por timeout e aplicação de histórico.
//
// Este módulo não toca o DOM. results.js injeta os efeitos de UI (progresso, render,
// armazenamento) através dos `hooks` de runBatch — isso é o que torna a orquestração
// testável com node:test sem precisar de um navegador de verdade.

import { checkUrl as defaultCheckUrl } from './analyzer.js';
import { detectPlatform } from './rules.js';
import { enrich as defaultEnrich } from './evidence.js';
import { createTikTokQueue, shouldPauseTikTokQueue } from './tiktokQueue.js';
import {
  CHECK_TIMEOUT_MS, TIKTOK_CHECK_TIMEOUT_MS, ENRICH_TIMEOUT_MS, RETRY_TIMEOUT_MS, GLOBAL_CONCURRENCY,
} from './config.js';

export class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.queue = [];
  }

  async acquire() {
    if (this.limit > 0) {
      this.limit--;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.limit++;
  }
}

// Impede que uma URL lenta ou com erro inesperado bloqueie a fila inteira.
export function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function timeoutResult(url, err) {
  const isTimeout = /^timeout/.test(String((err && err.message) || err));
  const platform = detectPlatform(new URL(url));
  return {
    url, host: safeHost(url), platform: platform?.id || null, platformName: platform?.name || null,
    kind: platform?.kind || 'site',
    checkedAt: new Date().toISOString(), via: 'fetch', httpStatus: null, finalUrl: '', redirected: false,
    title: '', faviconUrl: '', faviconData: '', status: 'indeterminado',
    reason: isTimeout
      ? 'Tempo esgotado — a verificação desta URL foi interrompida para não travar a análise das demais'
      : `Erro inesperado ao analisar: ${(err && err.message) || err}`,
    confidence: 'baixa', tags: isTimeout ? ['timeout'] : ['erro'], sha256: '', info: {},
  };
}

export function cancelledResult(url) {
  const platform = detectPlatform(new URL(url));
  return {
    url, host: safeHost(url), platform: platform?.id || null, platformName: platform?.name || null, kind: platform?.kind || 'site',
    checkedAt: new Date().toISOString(), via: 'fetch', httpStatus: null, finalUrl: '', redirected: false,
    title: '', faviconUrl: '', faviconData: '', status: 'indeterminado',
    reason: 'Análise cancelada pelo usuário', confidence: 'baixa', tags: ['cancelado'], sha256: '', info: {},
  };
}

function linkAbort(controller, signal) {
  if (!signal) return () => {};
  if (signal.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  return () => signal.removeEventListener('abort', onAbort);
}

/**
 * Cancela o trabalho que excedeu o prazo antes de iniciar uma nova tentativa.
 * `checkUrlFn` é injetável para teste; em produção é sempre checkUrl (lib/analyzer.js).
 */
export async function checkUrlWithRetry(url, ctx, signal, checkUrlFn = defaultCheckUrl) {
  const platform = detectPlatform(new URL(url));
  const isFacebookMarketplace = platform?.id === 'facebook' && platform.kind === 'marketplace';
  const runAttempt = (timeoutMs, label) => {
    const controller = new AbortController();
    const unlink = linkAbort(controller, signal);
    const attempt = withTimeout(
      checkUrlFn(url, { ...ctx, signal: controller.signal }),
      timeoutMs,
      label,
    );
    return attempt.catch((err) => {
      controller.abort();
      throw err;
    }).finally(unlink);
  };
  try {
    const timeoutMs = platform?.id === 'tiktok' ? TIKTOK_CHECK_TIMEOUT_MS : CHECK_TIMEOUT_MS;
    return await runAttempt(timeoutMs, `checkUrl ${url}`);
  } catch (err) {
    const isTimeout = /^timeout/.test(String((err && err.message) || err));
    if (!isTimeout || isFacebookMarketplace || platform?.id === 'tiktok' || (signal && signal.aborted)) throw err;
    return await runAttempt(RETRY_TIMEOUT_MS, `checkUrl retry ${url}`);
  }
}

/**
 * Processa `urls` com: teto global de concorrência (GLOBAL_CONCURRENCY), semáforos por
 * host/plataforma (semFor) e a fila serializada do TikTok — exatamente o mesmo
 * comportamento que estava embutido em results.js antes da extração.
 *
 * `ctx` é o contexto passado a checkUrl (fetchFn, doh, readTab, opts, signal).
 * `hist` é o objeto de histórico; o hook `applyHistory` o muta e muta o resultado, como antes.
 *
 * `hooks` (todos opcionais) substituem o acoplamento direto ao DOM/estado da página, chamados
 * exatamente nos mesmos pontos em que results.js chamava os equivalentes antes da extração:
 *   - onActiveChange(delta): +1 ao iniciar uma URL, -1 ao terminar (equivalente a state.active++/--).
 *   - onDone(): chamado quando uma URL conclui (inclusive canceladas), antes de onProgress/onRender.
 *   - onResult(url, result): chamado quando o resultado final de uma URL é gravado.
 *   - onProgress(): equivalente a setProgress(); chamado ao iniciar e ao concluir uma URL.
 *   - onRender(): equivalente a scheduleRender(); chamado só ao concluir uma URL (não ao iniciar).
 *   - applyManualClassification(result): aplica o overlay de classificação manual; por padrão é no-op.
 *   - applyHistory(hist, result): aplica o histórico; por padrão é no-op.
 *   - checkUrlFn, enrichFn: injeção para teste; em produção usam checkUrl e enrich reais.
 *
 * Retorna { results, tiktokPausedCount, tiktokQueuePauseReason }.
 */
export async function runBatch(urls, ctx, hist, hooks = {}) {
  const {
    onActiveChange = () => {},
    onDone = () => {},
    onResult = () => {},
    onProgress = () => {},
    onRender = () => {},
    applyManualClassification = () => {},
    applyHistory = () => {},
    checkUrlFn = defaultCheckUrl,
    enrichFn = defaultEnrich,
  } = hooks;
  const signal = ctx.signal;
  const results = new Map();
  const sems = new Map();
  const tiktokQueue = createTikTokQueue();
  const semFor = (url) => {
    const u = new URL(url);
    const p = detectPlatform(u);
    const isFacebookMarketplace = p?.id === 'facebook' && p.kind === 'marketplace';
    const key = isFacebookMarketplace ? 'facebook-marketplace' : p ? p.id : u.hostname;
    const limit = isFacebookMarketplace ? 1 : p ? 2 : 3;
    if (!sems.has(key)) sems.set(key, new Semaphore(limit));
    return sems.get(key);
  };

  let next = 0;
  let tiktokQueuePauseReason = '';
  let tiktokPausedCount = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (signal?.aborted) break; // não inicia novas URLs depois de "Cancelar análise"
      const url = urls[next++];
      const platform = detectPlatform(new URL(url));
      const isTikTok = platform?.id === 'tiktok';
      const sem = isTikTok ? null : semFor(url);
      const tiktokTurn = isTikTok ? await tiktokQueue.acquire(signal) : null;
      if (sem) await sem.acquire();
      onActiveChange(1);
      onProgress();
      try {
        let res;
        const startedAt = performance.now();
        let analysisMs = 0;
        let enrichmentMs = 0;
        try {
          if (isTikTok && !tiktokTurn.proceed) {
            tiktokPausedCount++;
            res = {
              url,
              host: safeHost(url),
              platform: platform.id,
              platformName: platform.name,
              kind: platform.kind,
              checkedAt: new Date().toISOString(),
              via: 'fetch',
              httpStatus: null,
              finalUrl: '',
              redirected: false,
              title: '',
              faviconUrl: '',
              faviconData: '',
              status: 'indeterminado',
              reason: `Verificação do TikTok pausada neste lote: ${tiktokTurn.reason}. Tente novamente mais tarde.`,
              confidence: 'baixa',
              tags: ['anti-bot', 'queue-paused'],
              sha256: '',
              info: {
                tabAttempted: false,
                tabFallback: 'Não iniciada: fila TikTok pausada após limite ou desafio anti-bot',
              },
            };
          } else {
            const analysisStartedAt = performance.now();
            try {
              res = await checkUrlWithRetry(url, ctx, signal, checkUrlFn);
            } finally {
              analysisMs = performance.now() - analysisStartedAt;
            }
            if (isTikTok && shouldPauseTikTokQueue(res)) {
              tiktokQueuePauseReason = res.httpStatus === 429
                ? 'foi recebida uma resposta HTTP 429 (limite de consultas)'
                : 'foi detectada uma tela de verificação anti-bot';
              tiktokQueue.pause(tiktokQueuePauseReason);
            }
            if (!isTikTok || !shouldPauseTikTokQueue(res)) {
              const enrichmentStartedAt = performance.now();
              try {
                await withTimeout(enrichFn(res, {
                  fetchFn: ctx.fetchFn,
                  doh: ctx.doh,
                }), ENRICH_TIMEOUT_MS, `enrich ${url}`);
              } finally {
                enrichmentMs = performance.now() - enrichmentStartedAt;
              }
            }
          }
        } catch (err) {
          res = timeoutResult(url, err);
        }
        if (!signal?.aborted) applyManualClassification(res);
        res.info = res.info || {};
        res.info.timings = {
          analysisMs: Math.round(analysisMs),
          enrichmentMs: Math.round(enrichmentMs),
          totalMs: Math.round(performance.now() - startedAt),
        };
        if (signal?.aborted) res = cancelledResult(url);
        else applyHistory(hist, res);
        results.set(url, res);
        onResult(url, res);
      } finally {
        onActiveChange(-1);
        if (tiktokTurn) tiktokTurn.release();
        else sem.release();
      }
      onDone();
      onProgress();
      onRender();
    }
  };
  await Promise.all(Array.from({ length: GLOBAL_CONCURRENCY }, worker));
  if (signal?.aborted) {
    for (const url of urls.slice(next)) {
      const res = cancelledResult(url);
      results.set(url, res);
      onResult(url, res);
      onDone();
    }
  }
  return { results, tiktokPausedCount, tiktokQueuePauseReason };
}
