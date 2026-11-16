import { TIKTOK_QUEUE_INTERVAL_MS } from './config.js';

function wait(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('Análise cancelada', 'AbortError'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createTikTokQueue(intervalMs = TIKTOK_QUEUE_INTERVAL_MS) {
  let tail = Promise.resolve();
  let lastCompletedAt = 0;
  let pauseReason = '';

  return {
    pause(reason) {
      if (!pauseReason) pauseReason = reason;
    },
    async acquire(signal) {
      let unlock;
      const previous = tail;
      tail = new Promise((resolve) => { unlock = resolve; });

      let released = false;
      let started = false;
      const release = () => {
        if (released) return;
        released = true;
        if (started) lastCompletedAt = Date.now();
        unlock();
      };

      if (signal?.aborted) {
        previous.then(release);
        return { proceed: false, reason: 'análise cancelada', release: () => {} };
      }

      let removeAbortListener = () => {};
      try {
        const hasTurn = await Promise.race([
          previous.then(() => true),
          new Promise((resolve) => {
            if (!signal) return;
            const onAbort = () => resolve(false);
            signal.addEventListener('abort', onAbort, { once: true });
            removeAbortListener = () => signal.removeEventListener('abort', onAbort);
          }),
        ]);
        removeAbortListener();
        if (!hasTurn) {
          previous.then(release);
          return { proceed: false, reason: 'análise cancelada', release: () => {} };
        }
        if (signal?.aborted) return { proceed: false, reason: 'análise cancelada', release };
        if (pauseReason) return { proceed: false, reason: pauseReason, release };
        await wait(Math.max(0, intervalMs - (Date.now() - lastCompletedAt)), signal);
        if (signal?.aborted) return { proceed: false, reason: 'análise cancelada', release };
        if (pauseReason) return { proceed: false, reason: pauseReason, release };
        started = true;
        return { proceed: true, reason: '', release };
      } catch (error) {
        release();
        if (signal?.aborted) {
          return { proceed: false, reason: 'análise cancelada', release: () => {} };
        }
        throw error;
      } finally {
        removeAbortListener();
      }
    },
  };
}

export function shouldPauseTikTokQueue(result) {
  if (result?.platform !== 'tiktok') return false;
  return result.httpStatus === 403
    || result.httpStatus === 429
    || result.reason === 'TikTok apresentou uma tela de espera ou verificação anti-bot'
    || result.reason === 'Não foi possível iniciar a sessão de aba dedicada do TikTok'
    || result.reason === 'Falha ao carregar o endereço TikTok na sessão dedicada'
    || result.reason === 'Falha ao ler a página na sessão TikTok dedicada';
}
