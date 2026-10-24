// Página principal: coordena a fila de análise, mantém o estado em memória e renderiza/exporta resultados.
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

const $ = (id) => document.getElementById(id);
installButtonSoundFeedback();

function showStorageWarning(message) {
  const warning = $('storageWarning');
  if (warning.textContent.split('\n').includes(message)) return;
  warning.textContent = warning.textContent ? `${warning.textContent}\n${message}` : message;
  warning.style.display = 'block';
}

const CATEGORIES = [
  { status: 'vivo', title: 'Links vivos', cls: 'ativa', section: 'vivoSection', label: 'VIVO' },
  { status: 'zumbi', title: 'Links zumbis', cls: 'erro', section: 'zumbiSection', label: 'ZUMBI' },
  { status: 'morto', title: 'Links mortos', cls: 'inativa', section: 'mortoSection', label: 'MORTO' },
  { status: 'indeterminado', title: 'Indeterminados (verificar manualmente)', cls: 'indet', section: 'indetSection', label: 'INDETERMINADO' },
];
const KIND_LABEL = { site: 'Site', marketplace: 'Marketplace', social: 'Rede social', messaging: 'Mensageria' };

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
  total: 0,
  done: 0,
  running: false,
  cancelled: false,
  abort: null, // AbortController do lote em andamento (botão "Cancelar análise")
};

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
  constructor(n) { this.n = n; this.q = []; }
  async acquire() { if (this.n > 0) { this.n--; return; } await new Promise((r) => this.q.push(r)); }
  release() { const r = this.q.shift(); if (r) r(); else this.n++; }
}

// Nunca deixa UMA url travada (rede lenta, aba que nao fecha, excecao inesperada...)
// bloquear a fila inteira: todo processamento por url tem um teto de tempo, e qualquer
// erro vira um resultado "indeterminado" em vez de derrubar o Promise.all().
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const CHECK_TIMEOUT_MS = 50000; // fetch (15s) + validação/diagnóstico DoH ou modo aba (~33s), com folga
const ENRICH_TIMEOUT_MS = 15000; // até dois favicons (~6s cada) com margem para resolução DNS

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
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
  state.running = true;
  state.cancelled = false;
  state.abort = new AbortController();
  $('btnCancelar').textContent = 'Cancelar análise';
  state.total = urls.length;
  state.done = 0;
  setButtons();
  let hist;
  try {
    hist = await loadHistory();
  } catch (err) {
    hist = {};
    showStorageWarning(`Não foi possível carregar o histórico; esta análise não mostrará comparações com verificações anteriores. Detalhe: ${(err && err.message) || err}`);
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
      try {
        setProgress(`Analisando ${state.done + 1} de ${state.total}: ${url}`);
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
          setProgress(`Coletando favicon: ${url}`);
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
  $('progressText').textContent = text || (state.running
    ? `Analisando… ${state.done} de ${state.total}`
    : `Análise concluída: ${state.done} de ${state.total} URLs.`);
}

function setButtons() {
  const has = state.results.size > 0 && !state.running;
  ['btnCsv', 'btnJson', 'btnReport', 'btnCopy'].forEach((id) => { $(id).disabled = !has; });
  $('btnRecheck').disabled = !has || !all().some((r) => r.status === 'indeterminado');
  $('btnCancelar').style.display = state.running ? '' : 'none';
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

const all = () => state.order.map((u) => state.results.get(u)).filter(Boolean);

let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; render(); });
}

function passesFilters(r) {
  const q = $('filtro').value.trim().toLowerCase();
  if (q) {
    const hay = [r.url, r.finalUrl, r.title, r.platformName, r.reason, r.status, ...(r.risk ? r.risk.brands : [])].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  const kind = $('filtroTipo').value;
  if (kind && r.kind !== kind) return false;
  return true;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
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

function badge(text, cls = '') { return el('span', `badge ${cls}`.trim(), text); }

function detailRow(dl, k, v) {
  if (v === undefined || v === null || v === '') return;
  dl.appendChild(el('dt', '', k));
  dl.appendChild(el('dd', '', String(v)));
}

function createItem(r, cat) {
  const item = el('div', `result-item ${cat.cls}${state.open.has(r.url) ? ' open' : ''}${state.opened.has(r.url) ? ' opened' : ''}${state.copiedUrl === r.url ? ' copied' : ''}`);
  const card = el('div', 'result-card');

  const fav = el('img', 'result-favicon');
  fav.alt = '';
  fav.referrerPolicy = 'no-referrer';
  // favicon já vem embutido (data URL): a tela de resultados não conecta ao servidor suspeito
  fav.src = r.faviconData || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%236750A4%22/%3E%3C/svg%3E';
  fav.addEventListener('error', () => { fav.removeAttribute('src'); });
  card.appendChild(fav);

  const content = el('div', 'result-content');
  const titleLine = el('div', 'result-title');
  titleLine.appendChild(el('span', 'result-title-text', r.title || r.url));
  titleLine.appendChild(el('span', 'result-status', cat.label + (r.httpStatus ? ` (${r.httpStatus})` : '')));
  content.appendChild(titleLine);
  content.appendChild(el('div', 'result-reason', r.reason));
  content.appendChild(el('div', 'result-url', r.url));

  const badges = el('div', 'badges');
  if (state.copiedUrl === r.url) badges.appendChild(badge('COPIADO', 'copied'));
  if (state.opened.has(r.url)) badges.appendChild(badge('ABERTO', 'opened'));
  if (r.platformName) badges.appendChild(badge(r.platformName));
  badges.appendChild(badge(KIND_LABEL[r.kind] || r.kind));
  if (r.tags.includes('takedown')) badges.appendChild(badge('DERRUBADO / SUSPENSO', 'takedown'));
  if (r.tags.includes('timeout')) badges.appendChild(badge('TIMEOUT', 'timeout'));
  if (r.tags.includes('cancelado')) badges.appendChild(badge('CANCELADO', 'cancelado'));
  if (r.tags.includes('custom')) badges.appendChild(badge('REGRA PERSONALIZADA', 'custom'));
  if (r.changed && r.previous) badges.appendChild(badge(`${r.previous.status.toUpperCase()} → ${r.status.toUpperCase()} (antes: ${fmtDate(r.previous.at)})`, 'changed'));
  (r.risk ? r.risk.brands : []).forEach((b) => badges.appendChild(badge(`Marca: ${b}`)));
  if (r.via !== 'fetch') badges.appendChild(badge(r.via === 'tab' ? 'via aba' : 'via API'));
  else if (r.info.tabAttempted) badges.appendChild(badge('modo aba tentado'));
  content.appendChild(badges);
  card.appendChild(content);

  const actions = el('div', 'actions');
  const selectLabel = el('label', 'select-result');
  selectLabel.addEventListener('click', (e) => e.stopPropagation());
  const select = el('input');
  select.type = 'checkbox';
  select.checked = state.selected.has(r.url);
  select.setAttribute('aria-label', `Selecionar ${r.title || r.url} para abrir em lote`);
  select.addEventListener('click', (e) => e.stopPropagation());
  select.addEventListener('change', (e) => {
    e.stopPropagation();
    if (select.checked) state.selected.add(r.url);
    else state.selected.delete(r.url);
    updateSelectionControls();
  });
  selectLabel.append(select, el('span', '', 'Selecionar'));

  const open = el('a', 'open-link', 'Abrir ↗');
  open.href = r.url;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  const markOpened = (e) => {
    e.stopPropagation();
    state.opened.add(r.url);
    scheduleRender();
  };
  open.addEventListener('click', markOpened);
  open.addEventListener('auxclick', (e) => {
    if (e.button === 1) markOpened(e);
  });
  const rerun = el('button', 'btn-mini btn-rerun', 'Refazer');
  rerun.type = 'button';
  rerun.disabled = state.running;
  rerun.title = 'Refazer a análise deste link';
  rerun.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (state.running) return;
    try {
      await runChecks([r.url], { tabMode: state.settings.tabMode, notifyOnComplete: false });
    } catch (err) {
      toast(`Não foi possível refazer a análise: ${(err && err.message) || err}`);
    }
  });
  const more = el('button', 'btn-mini', 'Detalhes');
  more.type = 'button';
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    item.classList.toggle('open');
    if (item.classList.contains('open')) state.open.add(r.url); else state.open.delete(r.url);
  });
  actions.append(selectLabel, open, rerun, more);
  card.appendChild(actions);
  item.appendChild(card);

  const dl = el('dl', 'details');
  detailRow(dl, 'URL final', r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : '');
  detailRow(dl, 'URL (defang)', defang(r.url));
  detailRow(dl, 'Verificado em', fmtDate(r.checkedAt));
  detailRow(dl, 'Cabeçalho detectado na aba', r.info.tabHeading);
  detailRow(dl, 'Trecho visível capturado', r.snippet);
  if (r.info.product) detailRow(dl, 'Produto/anúncio', [r.info.product.name, r.info.product.price && `${r.info.product.currency} ${r.info.product.price}`, r.info.product.seller && `vendedor: ${r.info.product.seller}`].filter(Boolean).join(' · '));
  detailRow(dl, 'Descrição', r.info.description);
  detailRow(dl, 'Autor', r.info.author);
  if (r.info.dns) detailRow(dl, 'DNS', `rcode ${r.info.dns.rcode}${r.info.dns.addresses && r.info.dns.addresses.length ? ' → ' + r.info.dns.addresses.join(', ') : ''}`);
  detailRow(dl, 'Fallback do modo aba', r.info.tabFallback);
  detailRow(dl, 'Erro do modo aba', r.info.tabError);
  if (r.info.timings) {
    const { analysisMs, enrichmentMs, totalMs } = r.info.timings;
    detailRow(dl, 'Tempo (análise / evidências / total)', `${analysisMs} ms / ${enrichmentMs} ms / ${totalMs} ms`);
  }
  detailRow(dl, 'SHA-256 do conteúdo', r.sha256);
  dl.addEventListener('click', (e) => e.stopPropagation());
  item.appendChild(dl);

  item.title = 'Clique para copiar a URL';
  item.addEventListener('click', async () => {
    const ok = await copyText(r.url);
    if (ok) {
      state.copiedUrl = r.url;
      scheduleRender();
      toast(`URL copiada: ${r.url}`);
    } else {
      toast('Não foi possível copiar — selecione e copie manualmente');
    }
  });
  return item;
}

function updateSelectionControls() {
  const count = state.selected.size;
  $('btnOpenSelected').disabled = count === 0;
  $('btnOpenSelected').textContent = count ? `Abrir selecionados (${count})` : 'Abrir selecionados';
  $('btnClearSelection').disabled = count === 0;
}

function openUrls(urls) {
  if (urls.length > 10 && !confirm(`Abrir ${urls.length} abas? Algumas podem ser páginas maliciosas.`)) return;
  urls.forEach((url) => {
    state.opened.add(url);
    window.open(url, '_blank', 'noopener');
  });
  scheduleRender();
}

function renderCategory(cat, items) {
  const container = $(cat.section);
  container.textContent = '';
  const header = el('div', 'category-header');
  header.setAttribute('role', 'button');
  header.tabIndex = 0;
  const left = el('div');
  left.appendChild(Object.assign(el('h2', 'category-header-title', cat.title)));
  left.appendChild(el('p', 'category-subtitle', `${items.length} link${items.length === 1 ? '' : 's'}`));
  const meta = el('div', 'category-header-meta');
  const openAll = el('button', 'btn', 'Abrir todos');
  openAll.type = 'button';
  openAll.disabled = !items.length;
  const copyAll = el('button', 'btn', 'Copiar todos');
  copyAll.type = 'button';
  copyAll.disabled = !items.length;
  const toggle = el('span', 'category-toggle', '▾');
  meta.append(openAll, copyAll, toggle);
  header.append(left, meta);

  const content = el('div', `category-content${state.collapsed.has(cat.status) ? ' collapsed' : ''}`);
  toggle.style.transform = state.collapsed.has(cat.status) ? 'rotate(-90deg)' : '';
  if (!items.length) {
    content.appendChild(el('div', 'empty-state', 'Nenhum resultado nesta categoria.'));
  } else {
    const list = el('div', 'result-list');
    items.forEach((r) => list.appendChild(createItem(r, cat)));
    content.appendChild(list);
  }
  header.addEventListener('click', () => {
    const c = content.classList.toggle('collapsed');
    if (c) state.collapsed.add(cat.status); else state.collapsed.delete(cat.status);
    toggle.style.transform = c ? 'rotate(-90deg)' : '';
  });
  openAll.addEventListener('click', (e) => {
    e.stopPropagation();
    openUrls(items.map((r) => r.url));
  });
  copyAll.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(items.map((r) => r.url).join('\n'));
    if (ok) {
      state.copiedUrl = null;
      scheduleRender();
      toast(items.length === 1 ? '1 URL copiada' : `${items.length} URLs copiadas`);
    } else {
      toast('Não foi possível copiar as URLs');
    }
  });
  container.append(header, content);
}

$('btnOpenSelected').addEventListener('click', () => {
  const urls = state.order.filter((url) => state.selected.has(url));
  openUrls(urls);
});
$('btnClearSelection').addEventListener('click', () => {
  state.selected.clear();
  scheduleRender();
  updateSelectionControls();
});

function renderSummary(list) {
  const s = $('summary');
  s.textContent = '';
  const count = (st) => list.filter((r) => r.status === st).length;
  const chips = [
    ['ativa', `Vivos: ${count('vivo')}`, 'vivoSection'],
    ['erro', `Zumbis: ${count('zumbi')}`, 'zumbiSection'],
    ['inativa', `Mortos: ${count('morto')}`, 'mortoSection'],
    ['indet', `Indeterminados: ${count('indeterminado')}`, 'indetSection'],
  ];
  const take = list.filter((r) => r.tags.includes('takedown')).length;
  const chg = list.filter((r) => r.changed).length;
  if (take) chips.push(['inativa', `Derrubados: ${take}`]);
  if (chg) chips.push(['indet', `Mudaram de status: ${chg}`]);
  chips.forEach(([c, t, section]) => {
    const chip = el(section ? 'a' : 'span', `chip ${c}`, t);
    if (section) chip.href = `#${section}`;
    s.appendChild(chip);
  });
}

function render() {
  const list = all();
  if (!list.length) return;
  updateSelectionControls();
  $('resultsSections').style.display = 'block';
  renderSummary(list);
  const filtered = list.filter(passesFilters);
  CATEGORIES.forEach((cat) => {
    const items = filtered.filter((r) => r.status === cat.status);
    renderCategory(cat, items);
  });
}

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

$('btnReport').addEventListener('click', () => download(`morto-vivo-relatorio-${stamp()}.html`, 'text/html;charset=utf-8', buildReport(all())));
$('btnCsv').addEventListener('click', () => download(`morto-vivo-${stamp()}.csv`, 'text/csv;charset=utf-8', toCsv(all())));
$('btnJson').addEventListener('click', () => download(`morto-vivo-${stamp()}.json`, 'application/json', toJson(all())));
$('btnCopy').addEventListener('click', async () => {
  const text = all().filter((r) => r.status === 'morto').map((r) => defang(r.url)).join('\n');
  try { await navigator.clipboard.writeText(text); $('btnCopy').textContent = 'Copiado ✓'; } catch { prompt('Copie:', text); }
  setTimeout(() => { $('btnCopy').textContent = 'Copiar mortos (defang)'; }, 2000);
});
$('btnRecheck').addEventListener('click', async () => {
  const urls = all().filter((r) => r.status === 'indeterminado').map((r) => r.url);
  let tabMode = state.settings.tabMode;
  if (!tabMode) {
    tabMode = confirm('Reverificar usando o MODO ABA?\n\nAbre as páginas de plataformas conhecidas (Shopee, Instagram, Facebook, X, TikTok…) em abas em segundo plano usando a sua sessão logada. Use um perfil de Chrome dedicado à investigação.');
  }
  await runChecks(urls, { tabMode });
});

['filtro', 'filtroTipo'].forEach((id) => $(id).addEventListener('input', scheduleRender));

/* ---------- início ---------- */

(async function main() {
  const urls = [...new Set(parseUrlsParam())];
  if (!urls.length) {
    $('erro').textContent = 'URL inválida ou nenhuma URL foi encontrada.';
    $('erro').style.display = 'block';
    $('progressText').textContent = 'Nada para analisar.';
    return;
  }
  try {
    state.settings = await loadSettings();
  } catch (err) {
    state.settings = { ...DEFAULT_SETTINGS };
    showStorageWarning(`Não foi possível carregar as configurações salvas; os padrões serão usados nesta análise. Detalhe: ${(err && err.message) || err}`);
  }
  state.brands = parseBrands(state.settings.brands);
  state.order = urls;
  await runChecks(urls, { tabMode: state.settings.tabMode });
})();
