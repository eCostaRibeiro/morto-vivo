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

export function createTikTokQueue(intervalMs = 2000) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;
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
      const release = () => {
        if (released) return;
        released = true;
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
        await wait(Math.max(0, intervalMs - (Date.now() - lastStartedAt)), signal);
        if (signal?.aborted) return { proceed: false, reason: 'análise cancelada', release };
        if (pauseReason) return { proceed: false, reason: pauseReason, release };
        lastStartedAt = Date.now();
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
  return result?.httpStatus === 429
    || (result?.platform === 'tiktok'
      && (
        result.reason === 'TikTok apresentou uma tela de espera ou verificação anti-bot'
        || result.reason?.startsWith('TikTok limitou ou desafiou a consulta (HTTP 403)')
      ));
}
