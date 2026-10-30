import { installButtonSoundFeedback } from './lib/audioFeedback.js';
import {
  clearQueryHistory, loadQueryHistory, MAX_QUERY_HISTORY, setQueryFavorite,
} from './lib/queryHistory.js';
import { discardImportedBatch, saveImportedBatch } from './lib/importedBatch.js';

const $ = (id) => document.getElementById(id);
installButtonSoundFeedback();

let entries = [];
let favorites = [];

function showError(message) {
  const error = $('historyError');
  error.textContent = message;
  error.hidden = false;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

function statusLabel(status) {
  return {
    vivo: 'Vivos',
    zumbi: 'Zumbis',
    morto: 'Mortos',
    indeterminado: 'Indeterminados',
  }[status];
}

function createEntry(entry, isFavorite) {
  const article = document.createElement('article');
  article.className = 'history-entry';
  const header = document.createElement('div');
  header.className = 'history-entry-header';
  const metadata = document.createElement('div');
  const date = document.createElement('time');
  date.dateTime = new Date(entry.createdAt).toISOString();
  date.textContent = formatDate(entry.createdAt);
  metadata.appendChild(date);
  const count = document.createElement('p');
  count.className = 'history-entry-count';
  count.textContent = `${entry.urls.length} URL${entry.urls.length === 1 ? '' : 's'} analisada${entry.urls.length === 1 ? '' : 's'}`;
  metadata.appendChild(count);

  const actions = document.createElement('div');
  actions.className = 'history-entry-actions';
  const favorite = document.createElement('button');
  favorite.className = `history-favorite${isFavorite ? ' is-favorite' : ''}`;
  favorite.type = 'button';
  favorite.textContent = isFavorite ? '★ Favoritada' : '☆ Favoritar';
  favorite.title = isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos';
  favorite.setAttribute('aria-pressed', String(isFavorite));
  favorite.setAttribute('aria-label', `${isFavorite ? 'Remover análise dos favoritos' : 'Favoritar análise'} de ${formatDate(entry.createdAt)}`);
  favorite.dataset.favoriteId = entry.id;
  favorite.addEventListener('click', async () => {
    favorite.disabled = true;
    try {
      ({ entries, favorites } = await setQueryFavorite(entry.id, !isFavorite));
      render();
      document.querySelector(`[data-favorite-id="${CSS.escape(entry.id)}"]`)?.focus();
    } catch (error) {
      favorite.disabled = false;
      showError(`Não foi possível atualizar os favoritos. Detalhe: ${(error && error.message) || error}`);
    }
  });
  actions.appendChild(favorite);

  const rerun = document.createElement('button');
  rerun.className = 'btn history-rerun';
  rerun.type = 'button';
  rerun.textContent = 'Refazer análise';
  rerun.setAttribute('aria-label', `Refazer análise de ${entry.urls.length} URLs de ${formatDate(entry.createdAt)}`);
  rerun.addEventListener('click', async () => {
    rerun.disabled = true;
    rerun.textContent = 'Preparando…';
    try {
      const batchId = await saveImportedBatch(entry.urls);
      const resultsPage = window.open(`results.html?batch=${encodeURIComponent(batchId)}`, '_blank');
      if (!resultsPage) {
        await discardImportedBatch(batchId);
        showError('O navegador bloqueou a nova aba. Permita pop-ups para refazer a análise.');
        rerun.disabled = false;
        rerun.textContent = 'Refazer análise';
      }
    } catch (error) {
      showError(`Não foi possível preparar a análise. Detalhe: ${(error && error.message) || error}`);
      rerun.disabled = false;
      rerun.textContent = 'Refazer análise';
    }
  });
  actions.appendChild(rerun);
  header.append(metadata, actions);
  article.appendChild(header);

  const statuses = document.createElement('div');
  statuses.className = 'history-statuses';
  Object.entries(entry.summary).forEach(([status, value]) => {
    const badge = document.createElement('span');
    badge.className = `history-status ${status}`;
    badge.textContent = `${statusLabel(status)}: ${value}`;
    statuses.appendChild(badge);
  });
  article.appendChild(statuses);

  const details = document.createElement('details');
  details.className = 'history-urls';
  const summary = document.createElement('summary');
  summary.textContent = `Ver URLs (${entry.urls.length})`;
  details.appendChild(summary);
  const list = document.createElement('ol');
  entry.urls.forEach((url) => {
    const item = document.createElement('li');
    item.textContent = url;
    list.appendChild(item);
  });
  details.appendChild(list);
  article.appendChild(details);
  return article;
}

function render() {
  const query = $('historySearch').value.trim().toLocaleLowerCase();
  const matchesSearch = (entry) => !query
    || entry.urls.some((url) => url.toLocaleLowerCase().includes(query));
  const favoriteIds = new Set(favorites.map((entry) => entry.id));
  const matchingFavorites = favorites.filter(matchesSearch);
  const matchingRecent = entries.filter((entry) => !favoriteIds.has(entry.id) && matchesSearch(entry));
  $('favoritesList').replaceChildren(...matchingFavorites.map((entry) => createEntry(entry, true)));
  $('historyList').replaceChildren(...matchingRecent.map((entry) => createEntry(entry, false)));
  $('historyCount').textContent = `${matchingFavorites.length} favoritas · ${matchingRecent.length} recentes`;
  $('favoritesCount').textContent = String(matchingFavorites.length);
  $('recentCount').textContent = String(matchingRecent.length);
  $('favoritesEmpty').hidden = favorites.length > 0 || Boolean(query);
  $('historyEmpty').hidden = entries.length > 0 || favorites.length > 0;
  $('historyNoMatches').hidden = (entries.length === 0 && favorites.length === 0)
    || matchingFavorites.length > 0 || matchingRecent.length > 0;
  $('btnClearQueryHistory').disabled = entries.length === 0 && favorites.length === 0;
}

$('historySearch').addEventListener('input', render);
$('btnManageRules').addEventListener('click', () => window.open('rules.html', '_blank'));
$('btnClearQueryHistory').addEventListener('click', async () => {
  if (!confirm('Apagar as análises recentes e favoritas? Isso não apaga as comparações de status por URL.')) return;
  try {
    await clearQueryHistory();
    entries = [];
    favorites = [];
    render();
    $('historyError').hidden = true;
  } catch (error) {
    showError(`Não foi possível limpar o histórico. Detalhe: ${(error && error.message) || error}`);
  }
});

async function init() {
  try {
    ({ entries, favorites } = await loadQueryHistory());
  } catch (error) {
    showError(`Não foi possível carregar o histórico. Detalhe: ${(error && error.message) || error}`);
  }
  render();
  if (entries.length >= MAX_QUERY_HISTORY) {
    $('recentCount').title = `São mantidas as ${MAX_QUERY_HISTORY} análises mais recentes.`;
  }
}

init();
