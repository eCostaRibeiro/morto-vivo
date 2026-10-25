// Orquestra a análise em lote, o estado da página e as exportações.
import { checkUrl } from './lib/analyzer.js';
import { makeDoh } from './lib/dns.js';
import { detectPlatform } from './lib/rules.js';
import { parseBrands } from './lib/risk.js';
import { defang } from './lib/normalize.js';
import { closeReusableTab, readInTab } from './lib/tabs.js';
import { enrich } from './lib/evidence.js';
import { loadHistory, applyHistory, saveHistory, loadSettings, DEFAULT_SETTINGS } from './lib/history.js';
import { buildReport, toCsv, toJson } from './lib/exports.js';
import { installButtonSoundFeedback } from './lib/audioFeedback.js';
import { CATEGORIES, closeActionMenu, createResultsView } from './lib/resultsView.js';
import { containsDebuggerPermission, requestDebuggerPermission } from './lib/permissions.js';

const $ = (id) => document.getElementById(id);
installButtonSoundFeedback();

function showStorageWarning(message) {
  const warning = $('storageWarning');
  if (warning.textContent.split('\n').includes(message)) return;
  warning.textContent = warning.textContent ? `${warning.textContent}\n${message}` : message;
  warning.style.display = 'block';
}

const state = {
  // results guarda o dado analisado; order preserva a ordem de entrada independente da conclusão dos workers.
  results: new Map(), // url -> resultado
  order: [],
  settings: null,
  brands: [],
  collapsed: new Set(),
  open: new Set(),
  opened: new Set(),
  selected: new Set(),
  copiedUrl: null,
  announcedSelectionCount: 0,
  total: 0,
  done: 0,
  active: 0,
  startedAt: 0,
  running: false,
  cancelled: false,
  abort: null, // AbortController do lote em andamento (botão "Cancelar análise")
};

const all = () => state.order.map((url) => state.results.get(url)).filter(Boolean);

/* ---------- entrada ---------- */

function parseUrlsParam() {
  const raw = new URLSearchParams(location.search).get('urls');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
  } catch { /* formato antigo */ }
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

/* ---------- execução ---------- */

class Semaphore {
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
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
// Incluem tempo para fetch, diagnóstico DoH/modo aba e uma margem de segurança.
const CHECK_TIMEOUT_MS = 50000;
const ENRICH_TIMEOUT_MS = 15000;

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function timeoutResult(url, err) {
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
    confidence: 'baixa', tags: isTimeout ? ['timeout'] : ['erro'], sha256: '', info: {}, risk: null,
  };
}

function cancelledResult(url) {
  const platform = detectPlatform(new URL(url));
  return {
    url, host: safeHost(url), platform: platform?.id || null, platformName: platform?.name || null, kind: platform?.kind || 'site',
    checkedAt: new Date().toISOString(), via: 'fetch', httpStatus: null, finalUrl: '', redirected: false,
    title: '', faviconUrl: '', faviconData: '', status: 'indeterminado',
    reason: 'Análise cancelada pelo usuário', confidence: 'baixa', tags: ['cancelado'], sha256: '', info: {}, risk: null,
  };
}

const RETRY_TIMEOUT_MS = 25000; // segunda tentativa, mais curta — falha de rede costuma ser passageira

/** Cancela o trabalho que excedeu o prazo antes de iniciar uma nova tentativa. */
async function checkUrlWithRetry(url, ctx, signal) {
  const platform = detectPlatform(new URL(url));
  const isFacebookMarketplace = platform?.id === 'facebook' && platform.kind === 'marketplace';
  const runAttempt = (timeoutMs, label) => {
    const controller = new AbortController();
    const unlink = linkAbort(controller, signal);
    const attempt = withTimeout(
      checkUrl(url, { ...ctx, signal: controller.signal }),
      timeoutMs,
      label,
    );
    return attempt.catch((err) => {
      controller.abort();
      throw err;
    }).finally(unlink);
  };
  try {
    return await runAttempt(CHECK_TIMEOUT_MS, `checkUrl ${url}`);
  } catch (err) {
    const isTimeout = /^timeout/.test(String((err && err.message) || err));
    if (!isTimeout || isFacebookMarketplace || (signal && signal.aborted)) throw err;
    return await runAttempt(RETRY_TIMEOUT_MS, `checkUrl retry ${url}`);
  }
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

// O tamanho do pool de workers abaixo (Promise.all) já É o teto global de concorrência:
// no máximo GLOBAL_CONCURRENCY URLs são processadas ao mesmo tempo, não importa quantos hosts
// distintos existam no lote (o limite por host/plataforma, em semFor, é um teto ADICIONAL
// mais apertado para não martelar um único domínio).
const GLOBAL_CONCURRENCY = 6;

async function runChecks(urls, { tabMode, notifyOnComplete = true }) {
  if (tabMode) {
    try {
      if (!(await containsDebuggerPermission())) {
        tabMode = false;
        showStorageWarning(
          'Modo aba indisponível: a permissão debugger não está concedida. '
          + 'Esta análise continuará sem leitura em aba; ative Modo aba no popup para solicitá-la.',
        );
      }
    } catch (err) {
      tabMode = false;
      showStorageWarning(
        `Não foi possível verificar a permissão do modo aba; esta análise continuará `
        + `sem leitura em aba. Detalhe: ${(err && err.message) || err}`,
      );
    }
  }
  state.running = true;
  state.cancelled = false;
  state.abort = new AbortController();
  state.startedAt = Date.now();
  $('btnCancelar').textContent = 'Cancelar análise';
  state.total = urls.length;
  state.done = 0;
  state.active = 0;
  const progressTimer = setInterval(() => setProgress(), 1000);
  setButtons();
  let hist;
  try {
    hist = await loadHistory();
  } catch (err) {
    hist = {};
    const detail = (err && err.message) || err;
    showStorageWarning(
      `Não foi possível carregar o histórico; esta análise não mostrará comparações `
      + `com verificações anteriores. Detalhe: ${detail}`,
    );
  }
  const ctx = {
    fetchFn: (...a) => fetch(...a),
    doh: makeDoh(),
    readTab: readInTab,
    brands: state.brands,
    signal: state.abort.signal,
    opts: { tabMode, timeoutMs: 15000 },
  };
  // Limite global é complementado por limites por plataforma/host para não concentrar requisições num destino.
  const sems = new Map();
  const semFor = (url) => {
    const u = new URL(url);
    const p = detectPlatform(u);
    const isFacebookMarketplace = p?.id === 'facebook' && p.kind === 'marketplace';
    const key = isFacebookMarketplace ? 'facebook-marketplace' : p ? p.id : u.hostname;
    if (!sems.has(key)) sems.set(key, new Semaphore(isFacebookMarketplace ? 1 : p ? 2 : 3));
    return sems.get(key);
  };

  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      if (state.abort.signal.aborted) break; // não inicia novas URLs depois de "Cancelar análise"
      const url = urls[next++];
      const sem = semFor(url);
      await sem.acquire();
      state.active++;
      setProgress();
      try {
        let res;
        const startedAt = performance.now();
        let analysisMs = 0;
        let enrichmentMs = 0;
        try {
          const analysisStartedAt = performance.now();
          try {
            res = await checkUrlWithRetry(url, ctx, state.abort.signal);
          } finally {
            analysisMs = performance.now() - analysisStartedAt;
          }
          const enrichmentStartedAt = performance.now();
          try {
            await withTimeout(enrich(res, {
              fetchFn: ctx.fetchFn,
              doh: ctx.doh,
            }), ENRICH_TIMEOUT_MS, `enrich ${url}`);
          } finally {
            enrichmentMs = performance.now() - enrichmentStartedAt;
          }
        } catch (err) {
          res = timeoutResult(url, err);
        }
        res.info = res.info || {};
        res.info.timings = {
          analysisMs: Math.round(analysisMs),
          enrichmentMs: Math.round(enrichmentMs),
          totalMs: Math.round(performance.now() - startedAt),
        };
        if (state.abort.signal.aborted) res = cancelledResult(url);
        else applyHistory(hist, res);
        state.results.set(url, res);
      } finally {
        state.active--;
        sem.release();
      }
      state.done++;
      setProgress();
      scheduleRender();
    }
  };
  await Promise.all(Array.from({ length: GLOBAL_CONCURRENCY }, worker));
  if (state.abort.signal.aborted) {
    for (const url of urls.slice(next)) {
      state.results.set(url, cancelledResult(url));
      state.done++;
    }
  }
  clearInterval(progressTimer);
  await closeReusableTab();
  try {
    await saveHistory(hist);
  } catch (err) {
    showStorageWarning(`Não foi possível salvar o histórico desta análise. Detalhe: ${(err && err.message) || err}`);
  }
  state.running = false;
  setProgress();
  scheduleRender();
  setButtons();
  if (notifyOnComplete && !state.cancelled) {
    const counts = Object.fromEntries(CATEGORIES.map((cat) => [
      cat.status,
      urls.map((url) => state.results.get(url))
        .filter((result) => result?.status === cat.status).length,
    ]));
    const message = `Monitoramento concluído: ${urls.length} links — ${counts.vivo} vivos, `
      + `${counts.zumbi} zumbis, ${counts.morto} mortos e ${counts.indeterminado} indeterminados.`;
    toast(message, 6500);
    notifyCompletion(message);
  }
}

/* ---------- UI ---------- */

function setProgress(text) {
  const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
  $('progressBar').style.width = `${pct}%`;
  $('progressTrack').setAttribute('aria-valuenow', String(pct));
  const pending = Math.max(0, state.total - state.done - state.active);
  $('progressText').textContent = text || (state.running
    ? state.cancelled
      ? `Cancelando: ${state.done} de ${state.total} concluídas; ${state.active} em andamento; ${pending} aguardando cancelamento.`
      : `Análise em andamento: ${state.done} de ${state.total} concluídas; ${state.active} em andamento; ${pending} na fila.`
    : `Análise concluída: ${state.done} de ${state.total} URLs.`);
  const elapsedSeconds = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const elapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const remaining = state.done > 0 && state.running && !state.cancelled
    ? Math.max(0, Math.ceil((elapsedSeconds / state.done) * (state.total - state.done)))
    : null;
  const eta = remaining === null ? '' : ` · estimativa restante ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  $('progressMeta').textContent = state.total
    ? `Tempo decorrido ${elapsed}${eta}`
    : '';
}

function setButtons() {
  const has = state.results.size > 0 && !state.running;
  ['btnCsv', 'btnJson', 'btnReport', 'btnCopy'].forEach((id) => { $(id).disabled = !has; });
  $('btnRecheck').disabled = !has || !all().some((r) => r.status === 'indeterminado');
  $('btnCancelar').style.display = state.running ? '' : 'none';
  $('btnCancelar').setAttribute('aria-hidden', String(!state.running));
  $('btnCancelar').disabled = !state.running || state.cancelled;
  document.querySelectorAll('.btn-rerun').forEach((button) => { button.disabled = state.running; });
}

$('btnCancelar').addEventListener('click', () => {
  if (!state.abort || state.abort.signal.aborted) return;
  state.cancelled = true;
  state.abort.abort();
  $('btnCancelar').disabled = true;
  $('btnCancelar').textContent = 'Cancelando…';
  setProgress('Cancelando — as URLs já em andamento estão terminando, as demais serão marcadas como canceladas.');
});

function openUrls(urls) {
  if (urls.length > 10 && !confirm(`Abrir ${urls.length} abas? Algumas podem ser páginas maliciosas.`)) return;
  urls.forEach((url) => {
    state.opened.add(url);
    window.open(url, '_blank', 'noopener');
  });
  scheduleRender();
}

let toastTimer = 0;
function toast(msg, duration = 1800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function sendExtensionNotification(title, message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'mv.createNotification', title, message }, (response) => {
      const messageError = chrome.runtime.lastError;
      if (messageError) {
        reject(new Error(messageError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || 'O service worker não confirmou a notificação.'));
        return;
      }
      resolve();
    });
  });
}

async function notifyCompletion(message) {
  if (!state.settings.completionNotification) return;
  try {
    await sendExtensionNotification('Monitoramento concluído', message);
  } catch (err) {
    toast(`Monitoramento concluído, mas a notificação do navegador falhou: ${(err && err.message) || err}`, 6500);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sem clipboard */ }
    ta.remove();
    return ok;
  }
}

let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderResults();
  });
}

const { render: renderResults } = createResultsView({
  state,
  scheduleRender,
  runChecks,
  openUrls,
  copyText,
  toast,
});

/* ---------- exportação ---------- */

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);

$('btnReport').addEventListener('click', () => {
  closeActionMenu($('btnReport').closest('details'));
  download(`morto-vivo-relatorio-${stamp()}.html`, 'text/html;charset=utf-8', buildReport(all()));
});
$('btnCsv').addEventListener('click', () => {
  closeActionMenu($('btnCsv').closest('details'));
  download(`morto-vivo-${stamp()}.csv`, 'text/csv;charset=utf-8', toCsv(all()));
});
$('btnJson').addEventListener('click', () => {
  closeActionMenu($('btnJson').closest('details'));
  download(`morto-vivo-${stamp()}.json`, 'application/json', toJson(all()));
});
$('btnCopy').addEventListener('click', async () => {
  closeActionMenu($('btnCopy').closest('details'));
  const text = all().filter((r) => r.status === 'morto').map((r) => defang(r.url)).join('\n');
  try { await navigator.clipboard.writeText(text); $('btnCopy').textContent = 'Copiado ✓'; } catch { prompt('Copie:', text); }
  setTimeout(() => { $('btnCopy').textContent = 'Copiar mortos (defang)'; }, 2000);
});
$('btnRecheck').addEventListener('click', async () => {
  closeActionMenu($('btnRecheck').closest('details'));
  const urls = all().filter((r) => r.status === 'indeterminado').map((r) => r.url);
  let tabMode = state.settings.tabMode;
  if (!tabMode) {
    tabMode = confirm('Reverificar usando o MODO ABA?\n\nAbre as páginas de plataformas conhecidas (Shopee, Instagram, Facebook, X, TikTok…) em abas em segundo plano usando a sua sessão logada. Use um perfil de Chrome dedicado à investigação.');
  }
  if (tabMode) {
    try {
      const granted = await requestDebuggerPermission();
      if (!granted) {
        tabMode = false;
        showStorageWarning(
          'Permissão para o modo aba não concedida. A reverificação continuará sem leitura em aba.',
        );
      }
    } catch (err) {
      tabMode = false;
      showStorageWarning(
        `Não foi possível ativar o modo aba; a reverificação continuará sem leitura `
        + `em aba. Detalhe: ${(err && err.message) || err}`,
      );
    }
  }
  await runChecks(urls, { tabMode });
});

$('filtro').addEventListener('input', scheduleRender);
$('filtroTipo').addEventListener('change', scheduleRender);

/* ---------- início ---------- */

(async function main() {
  const urls = [...new Set(parseUrlsParam())];
  if (!urls.length) {
    $('erro').textContent = 'URL inválida ou nenhuma URL foi encontrada.';
    $('erro').hidden = false;
    $('progressText').textContent = 'Nada para analisar.';
    return;
  }
  try {
    state.settings = await loadSettings();
  } catch (err) {
    state.settings = { ...DEFAULT_SETTINGS };
    const detail = (err && err.message) || err;
    showStorageWarning(
      `Não foi possível carregar as configurações salvas; os padrões serão usados `
      + `nesta análise. Detalhe: ${detail}`,
    );
  }
  state.brands = parseBrands(state.settings.brands);
  state.order = urls;
  await runChecks(urls, { tabMode: state.settings.tabMode });
})();
