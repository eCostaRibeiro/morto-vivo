// Orquestra a análise em lote, o estado da página e as exportações.
// A concorrência/retry/fila do TikTok em si vivem em lib/batchRunner.js (testável sem DOM);
// este arquivo só amarra esse motor ao estado da página e aos elementos da UI.
import { makeDoh } from './lib/dns.js';
import { defang } from './lib/normalize.js';
import { closeReusableTab, readInTab } from './lib/tabs.js';
import {
  loadHistory, applyHistory, saveHistory, loadManualClassifications, saveManualClassifications,
  loadSettings, DEFAULT_SETTINGS,
} from './lib/history.js';
import { buildReport, toCsv, toJson } from './lib/exports.js';
import { installButtonSoundFeedback } from './lib/audioFeedback.js';
import { CATEGORIES, closeActionMenu, createResultsView } from './lib/resultsView.js';
import { consumeImportedBatch, ImportedBatchExpiredError } from './lib/importedBatch.js';
import { norm } from './lib/text.js';
import {
  applyManualClassification as applyManualClassificationOverride,
  clearManualClassification,
} from './lib/manualClassification.js';
import { FETCH_PAGE_TIMEOUT_MS } from './lib/config.js';
import { runBatch } from './lib/batchRunner.js';

const $ = (id) => document.getElementById(id);
installButtonSoundFeedback();
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

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
  manualClassifications: {},
  collapsed: new Set(),
  displayLimits: new Map(),
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
// Semaphore, withTimeout, safeHost, timeoutResult, cancelledResult, checkUrlWithRetry e o
// próprio laço de concorrência/retry/fila do TikTok vivem em lib/batchRunner.js (runBatch),
// testável sem DOM. Este arquivo só fornece os hooks que ligam esse motor à página.

function applyManualClassification(result) {
  const manualStatus = state.manualClassifications[result.url];
  if (!manualStatus) return result;
  return applyManualClassificationOverride(result, manualStatus);
}

async function setManualClassification(url, status) {
  const next = { ...state.manualClassifications };
  if (status) next[url] = status;
  else delete next[url];
  await saveManualClassifications(next);
  state.manualClassifications = next;

  const result = state.results.get(url);
  if (result) {
    if (status) applyManualClassificationOverride(result, status);
    else clearManualClassification(result);
    scheduleRender();
  }
}

async function setManualClassifications(urls, status) {
  const next = { ...state.manualClassifications };
  urls.forEach((url) => {
    if (status) next[url] = status;
    else delete next[url];
  });
  await saveManualClassifications(next);
  state.manualClassifications = next;

  urls.forEach((url) => {
    const result = state.results.get(url);
    if (!result) return;
    if (status) applyManualClassificationOverride(result, status);
    else clearManualClassification(result);
  });
  state.selected.clear();
  scheduleRender();
}

async function runChecks(urls, { tabMode, notifyOnComplete = true }) {
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
    signal: state.abort.signal,
    opts: {
      tabMode,
      timeoutMs: FETCH_PAGE_TIMEOUT_MS,
      customRules: state.settings.customRules.map((rule) => ({
        ...rule,
        normalizedTerm: norm(rule.term),
      })),
    },
  };
  // A concorrência global, os semáforos por host/plataforma e a fila do TikTok vivem em
  // runBatch (lib/batchRunner.js); aqui só ligamos os hooks dela ao estado/DOM da página.
  const { tiktokPausedCount, tiktokQueuePauseReason } = await runBatch(urls, ctx, hist, {
    onActiveChange: (delta) => { state.active += delta; },
    onDone: () => { state.done++; },
    onResult: (url, res) => { state.results.set(url, res); },
    onProgress: () => setProgress(),
    onRender: () => scheduleRender(),
    applyManualClassification,
    applyHistory,
  });
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
    let message = `Monitoramento concluído: ${urls.length} links — ${counts.vivo} vivos, `
      + `${counts.zumbi} zumbis, ${counts.morto} mortos e ${counts.indeterminado} indeterminados.`;
    if (tiktokPausedCount) {
      message += ` TikTok pausado: ${tiktokPausedCount} perfil(is) não consultado(s) após ${tiktokQueuePauseReason}.`;
    }
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
    ? `Versão ${EXTENSION_VERSION} · Tempo decorrido ${elapsed}${eta}`
    : `Versão ${EXTENSION_VERSION}`;
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

$('btnManageRules').addEventListener('click', () => window.open('rules.html', '_blank'));
$('bulkClassification').addEventListener('change', async (event) => {
  const select = event.currentTarget;
  if (!select.value || !state.selected.size || state.running) return;
  const urls = [...state.selected];
  const status = select.value === 'automatico' ? null : select.value;
  select.disabled = true;
  try {
    await setManualClassifications(urls, status);
    toast(status
      ? `${urls.length} ${urls.length === 1 ? 'card movido' : 'cards movidos'} para ${status.toUpperCase()}`
      : `Classificação automática restaurada em ${urls.length} ${urls.length === 1 ? 'card' : 'cards'}`,
      3000);
  } catch (err) {
    toast(`Não foi possível salvar as classificações do lote: ${(err && err.message) || err}`, 5000);
  } finally {
    select.value = '';
    select.disabled = state.running || !state.selected.size;
  }
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
  setManualClassification,
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
  await runChecks(urls, { tabMode });
});

$('filtro').addEventListener('input', scheduleRender);
$('filtroTipo').addEventListener('change', scheduleRender);

const btnScrollTop = $('btnScrollTop');
if (btnScrollTop) {
  window.addEventListener('scroll', () => {
    btnScrollTop.hidden = window.scrollY < 300;
  }, { passive: true });
  btnScrollTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('filtro')?.focus({ preventScroll: true });
  });
}

/* ---------- início ---------- */

(async function main() {
  $('extensionVersion').textContent = `Versão ${EXTENSION_VERSION}`;
  const batchId = new URLSearchParams(location.search).get('batch');
  let inputUrls;
  try {
    inputUrls = batchId ? await consumeImportedBatch(batchId) : parseUrlsParam();
  } catch (err) {
    if (err instanceof ImportedBatchExpiredError) {
      $('erro').textContent = 'A lista importada expirou após 24 horas. Volte ao popup e importe o arquivo novamente.';
      $('erro').hidden = false;
      $('progressText').textContent = 'Nada para analisar.';
      return;
    }
    const detail = (err && err.message) || err;
    $('erro').textContent = `Não foi possível carregar a lista importada do armazenamento local. Detalhe: ${detail}`;
    $('erro').hidden = false;
    $('progressText').textContent = 'Nada para analisar.';
    return;
  }
  const urls = [...new Set(inputUrls || [])];
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
  try {
    state.manualClassifications = await loadManualClassifications();
  } catch (err) {
    const detail = (err && err.message) || err;
    showStorageWarning(`Não foi possível carregar as classificações manuais salvas. Detalhe: ${detail}`);
  }
  state.order = urls;
  await runChecks(urls, { tabMode: state.settings.tabMode });
})();
