import { defang } from './normalize.js';
import { hasEffectiveTakedown } from './manualClassification.js';

// Keeps DOM rendering and result interactions separate from batch orchestration.
export const CATEGORIES = [
  { status: 'vivo', title: 'Links vivos', cls: 'ativa', section: 'vivoSection', label: 'VIVO' },
  { status: 'zumbi', title: 'Links zumbis', cls: 'erro', section: 'zumbiSection', label: 'ZUMBI' },
  { status: 'morto', title: 'Links mortos', cls: 'inativa', section: 'mortoSection', label: 'MORTO' },
  { status: 'indeterminado', title: 'Indeterminados (verificar manualmente)', cls: 'indet', section: 'indetSection', label: 'INDETERMINADO' },
];
const KIND_LABEL = { site: 'Site', marketplace: 'Marketplace', advertisement: 'Anúncio', social: 'Rede social', messaging: 'Mensageria' };

export function closeActionMenu(menu) {
  if (!menu) return;
  menu.open = false;
  menu.querySelector(':scope > summary')?.focus();
}

export function createResultsView({
  state, scheduleRender, runChecks, openUrls, copyText, toast, setManualClassification,
}) {
  const $ = (id) => document.getElementById(id);
  const all = () => state.order.map((url) => state.results.get(url)).filter(Boolean);
  const animatedResults = new Set();

  document.addEventListener('click', (event) => {
    const clickedMenu = event.target.closest?.('details.action-menu');
    document.querySelectorAll('details.action-menu[open]').forEach((menu) => {
      if (menu === clickedMenu) return;
      menu.open = false;
      menu.closest('.result-item')?.classList.remove('menu-open');
    });
  });

  document.addEventListener('toggle', (event) => {
    const openedMenu = event.target;
    if (!openedMenu.matches?.('details.action-menu[open]')) return;
    document.querySelectorAll('details.action-menu[open]').forEach((menu) => {
      if (menu === openedMenu) return;
      menu.open = false;
      menu.closest('.result-item')?.classList.remove('menu-open');
    });
  }, true);

  function passesFilters(r) {
    const q = $('filtro').value.trim().toLowerCase();
    if (q) {
      const hay = [r.url, r.finalUrl, r.title, r.platformName, r.reason, r.status].join(' ').toLowerCase();
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

  function badge(text, cls = '') { return el('span', `badge ${cls}`.trim(), text); }

  function detailRow(dl, k, v) {
    if (v === undefined || v === null || v === '') return;
    dl.appendChild(el('dt', '', k));
    dl.appendChild(el('dd', '', String(v)));
  }

  function createItem(r, cat) {
    const itemClasses = [
      'result-item',
      cat.cls,
      state.open.has(r.url) && 'open',
      state.opened.has(r.url) && 'opened',
      state.copiedUrl === r.url && 'copied',
    ].filter(Boolean).join(' ');
    const item = el('li', itemClasses);
    if (!animatedResults.has(r.url)) {
      item.classList.add('result-enter');
      animatedResults.add(r.url);
    }
    const card = el('div', 'result-card');

    const fav = el('img', 'result-favicon');
    fav.alt = '';
    fav.referrerPolicy = 'no-referrer';
    // favicon já vem embutido (data URL): a tela de resultados não conecta ao servidor suspeito
    const fallbackFavicon = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 '
      + 'viewBox=%220 0 16 16%22%3E%3Crect width=%2216%22 height=%2216%22 rx=%223%22 '
      + 'fill=%22%236750A4%22/%3E%3C/svg%3E';
    fav.src = r.faviconData || fallbackFavicon;
    fav.addEventListener('error', () => { fav.removeAttribute('src'); });
    card.appendChild(fav);

    const content = el('div', 'result-content');
    const titleLine = el('div', 'result-title');
    titleLine.appendChild(el('h3', 'result-title-text', r.title || r.url));
    const status = el('span', 'result-status', cat.label + (r.httpStatus ? ` (${r.httpStatus})` : ''));
    status.title = r.manualClassification
      ? `${r.reason}. Automática: ${r.automaticStatus} — ${r.automaticReason}.`
      : `${r.reason} Confiança ${r.confidence || 'não informada'}.`;
    titleLine.appendChild(status);
    content.appendChild(titleLine);
    content.appendChild(el('div', 'result-reason', r.reason));
    content.appendChild(el('div', 'result-url', r.url));

    const badges = el('div', 'badges');
    if (state.copiedUrl === r.url) {
      const copied = badge('COPIADO', 'copied');
      copied.title = 'A URL deste resultado foi copiada para a área de transferência.';
      badges.appendChild(copied);
    }
    if (state.opened.has(r.url)) {
      const opened = badge('ABERTO', 'opened');
      opened.title = 'A URL deste resultado foi aberta em uma aba.';
      badges.appendChild(opened);
    }
    if (r.platformName) {
      const platform = badge(r.platformName);
      platform.title = `Plataforma identificada pelo domínio: ${r.platformName}.`;
      badges.appendChild(platform);
    }
    const kind = badge(KIND_LABEL[r.kind] || r.kind);
    kind.title = 'Tipo de endereço usado pelo filtro de categorias.';
    badges.appendChild(kind);
    if (hasEffectiveTakedown(r)) {
      const takedown = badge('DERRUBADO / SUSPENSO', 'takedown');
      takedown.title = 'A página apresentou um sinal reconhecido de remoção, suspensão ou takedown; confirme manualmente.';
      badges.appendChild(takedown);
    }
    if (r.tags.includes('parked')) {
      const parked = badge('DOMÍNIO ESTACIONADO', 'timeout');
      parked.title = 'A página indica domínio estacionado ou anunciado para venda; isso não confirma takedown.';
      badges.appendChild(parked);
    }
    if (r.tags.includes('timeout')) {
      const timeout = badge('TIMEOUT', 'timeout');
      timeout.title = 'A verificação excedeu o limite de tempo configurado.';
      badges.appendChild(timeout);
    }
    if (r.tags.includes('download')) {
      const download = badge('ARQUIVO', 'download');
      download.title = `Resposta HTTP ${r.httpStatus} com tipo de conteúdo ${r.info.contentType || 'não informado'}.`;
      badges.appendChild(download);
    }
    if (r.tags.includes('cloudflare')) {
      const cloudflare = badge('CLOUDFLARE', 'timeout');
      cloudflare.title = 'Erro temporário de conexão entre Cloudflare e o servidor de origem.';
      badges.appendChild(cloudflare);
    }
    if (r.tags.includes('redirect-externo')) {
      const redirect = badge('REDIRECIONAMENTO EXTERNO', 'changed');
      redirect.title = 'O domínio redirecionou para outro domínio; confirme se o destino representa o conteúdo esperado.';
      badges.appendChild(redirect);
    }
    if (r.tags.includes('cancelado')) {
      const cancelled = badge('CANCELADO', 'cancelado');
      cancelled.title = 'Esta URL não foi verificada porque o lote foi cancelado.';
      badges.appendChild(cancelled);
    }
    if (r.tags.includes('custom')) {
      const custom = badge('REGRA PERSONALIZADA', 'custom');
      custom.title = 'Este resultado foi definido por uma regra personalizada.';
      badges.appendChild(custom);
    }
    if (r.manualClassification) {
      const manual = badge('CLASSIFICAÇÃO MANUAL', 'manual');
      manual.title = 'O status exibido foi definido manualmente; a classificação automática permanece nos detalhes.';
      badges.appendChild(manual);
      if (r.manualClassification !== r.automaticStatus) {
        const discrepancy = badge(
          `MANUAL: ${r.manualClassification} · AUTOMÁTICA AGORA: ${r.automaticStatus}`,
          'manual-difference',
        );
        discrepancy.title = `A classificação manual (${r.manualClassification}) difere da automática (${r.automaticStatus}: ${r.automaticReason}).`;
        badges.appendChild(discrepancy);
      }
    }
    if (r.tags.includes('http-fallback')) {
      const httpFallback = badge('VIA HTTP ALTERNATIVO', 'timeout');
      httpFallback.title = 'HTTPS falhou; o resultado usa uma resposta HTTP sem criptografia e a confiança não ultrapassa média.';
      badges.appendChild(httpFallback);
    }
    if (r.changed && r.previous) {
      const previousStatus = r.previous.status.toUpperCase();
      const currentStatus = r.status.toUpperCase();
      badges.appendChild(badge(
        `${previousStatus} → ${currentStatus} (antes: ${fmtDate(r.previous.at)})`,
        'changed',
      ));
    }
    if (r.via !== 'fetch') {
      const via = badge(r.via === 'tab' ? 'via aba' : 'via API');
      via.title = r.via === 'tab'
        ? 'O resultado usa conteúdo lido de uma aba do navegador.'
        : 'O resultado foi obtido por uma sonda de API pública da plataforma.';
      badges.appendChild(via);
    } else if (r.info.tabAttempted) {
      const tabAttempt = badge('modo aba tentado');
      tabAttempt.title = 'A extensão tentou ler a página renderizada em uma aba, mas não usou esse conteúdo no resultado final.';
      badges.appendChild(tabAttempt);
    } else if (r.info.tabFallback?.startsWith('Não iniciada:')) {
      const tabNotStarted = badge('aba não iniciada', 'timeout');
      tabNotStarted.title = r.info.tabFallback;
      badges.appendChild(tabNotStarted);
    }
    content.appendChild(badges);
    card.appendChild(content);

    const actions = el('div', 'actions');
    actions.addEventListener('click', (e) => e.stopPropagation());
    const selectLabel = el('label', 'select-result');
    selectLabel.addEventListener('click', (e) => e.stopPropagation());
    const select = el('input');
    select.type = 'checkbox';
    select.checked = state.selected.has(r.url);
    select.setAttribute('aria-label', `Selecionar ${r.title || r.url} para abrir em lote`);
    select.title = 'Inclui este resultado na ação Abrir selecionados.';
    select.dataset.focusKey = `select:${r.url}`;
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
    open.setAttribute('aria-label', `Abrir ${r.title || r.url} em nova aba`);
    open.title = 'Abre a URL original em uma nova aba.';
    open.dataset.focusKey = `open:${r.url}`;
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
    rerun.setAttribute('aria-label', `Refazer análise: ${r.title || r.url}`);
    rerun.dataset.focusKey = `rerun:${r.url}`;
    rerun.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeActionMenu(moreMenu);
      if (state.running) return;
      try {
        await runChecks([r.url], { tabMode: state.settings.tabMode, notifyOnComplete: false });
      } catch (err) {
        toast(`Não foi possível refazer a análise: ${(err && err.message) || err}`);
      }
    });
    const more = el('button', 'btn-mini', 'Detalhes');
    more.type = 'button';
    more.title = 'Mostra ou oculta as evidências capturadas nesta verificação.';
    const detailsId = `details-${state.order.indexOf(r.url)}`;
    more.setAttribute('aria-controls', detailsId);
    more.setAttribute('aria-expanded', String(state.open.has(r.url)));
    more.setAttribute('aria-label', `${state.open.has(r.url) ? 'Ocultar' : 'Mostrar'} detalhes: ${r.title || r.url}`);
    more.dataset.focusKey = `details:${r.url}`;
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      closeActionMenu(moreMenu);
      item.classList.toggle('open');
      const isOpen = item.classList.contains('open');
      dl.classList.toggle('expanded', isOpen);
      dl.setAttribute('aria-hidden', String(!isOpen));
      dl.inert = !isOpen;
      more.setAttribute('aria-expanded', String(isOpen));
      more.setAttribute('aria-label', `${isOpen ? 'Ocultar' : 'Mostrar'} detalhes: ${r.title || r.url}`);
      if (isOpen) state.open.add(r.url); else state.open.delete(r.url);
    });
    const copy = el('button', 'btn-mini', 'Copiar URL');
    copy.type = 'button';
    copy.title = 'Copia a URL original, sem defang.';
    copy.setAttribute('aria-label', `Copiar URL: ${r.title || r.url}`);
    copy.dataset.focusKey = `copy:${r.url}`;
    const copyResultUrl = async () => {
      const ok = await copyText(r.url);
      if (ok) {
        state.copiedUrl = r.url;
        scheduleRender();
        toast(`URL copiada: ${r.url}`);
      } else {
        toast('Não foi possível copiar — selecione e copie manualmente');
      }
    };
    copy.addEventListener('click', copyResultUrl);
    card.title = 'Clique no cartão para copiar a URL';
    card.addEventListener('click', copyResultUrl);
    const moreMenu = el('details', 'action-menu item-more-menu');
    moreMenu.addEventListener('toggle', () => {
      item.classList.toggle('menu-open', moreMenu.open);
    });
    const moreSummary = el('summary', 'menu-trigger', 'Mais');
    moreSummary.title = 'Abre ações adicionais para este resultado.';
    moreSummary.dataset.focusKey = `more:${r.url}`;
    moreMenu.appendChild(moreSummary);
    const moreContent = el('div', 'menu-content');
    const manualLabel = el('label', 'manual-classification-label', 'Classificação da lista');
    const manualSelect = el('select', 'manual-classification');
    manualSelect.setAttribute('aria-label', `Classificação manual para ${r.title || r.url}`);
    manualSelect.dataset.focusKey = `manual-classification:${r.url}`;
    const manualOptions = [
      ['', 'Automática'],
      ['vivo', 'Vivo'],
      ['zumbi', 'Zumbi'],
      ['morto', 'Morto'],
      ['indeterminado', 'Indeterminado'],
    ];
    manualOptions.forEach(([value, label]) => {
      const option = el('option', '', label);
      option.value = value;
      manualSelect.appendChild(option);
    });
    manualSelect.value = r.manualClassification || '';
    manualSelect.disabled = state.running;
    manualSelect.title = 'Altera apenas a classificação desta lista; não muda as evidências automáticas.';
    manualSelect.addEventListener('click', (event) => event.stopPropagation());
    manualSelect.addEventListener('change', async (event) => {
      event.stopPropagation();
      try {
        await setManualClassification(r.url, manualSelect.value || null);
        toast(manualSelect.value
          ? `Classificação manual definida: ${manualSelect.options[manualSelect.selectedIndex].text}`
          : 'Classificação automática restaurada');
      } catch (error) {
        toast(`Não foi possível salvar a classificação manual: ${(error && error.message) || error}`);
        scheduleRender();
      }
    });
    manualLabel.appendChild(manualSelect);
    moreContent.appendChild(manualLabel);
    moreContent.appendChild(more);
    moreMenu.appendChild(moreContent);
    actions.append(selectLabel, open, copy, rerun, moreMenu);
    card.appendChild(actions);
    item.appendChild(card);

    const dl = el('dl', 'details');
    dl.id = detailsId;
    const detailsOpen = state.open.has(r.url);
    dl.classList.toggle('expanded', detailsOpen);
    dl.setAttribute('aria-hidden', String(!detailsOpen));
    dl.inert = !detailsOpen;
    detailRow(dl, 'URL final', r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : '');
    if (r.manualClassification) {
      detailRow(dl, 'Classificação automática', `${r.automaticStatus}: ${r.automaticReason}`);
      detailRow(dl, 'Classificação manual', r.manualClassification);
    }
    detailRow(dl, 'Fallback HTTP', r.info.httpFallback || r.info.httpFallbackError);
    detailRow(dl, 'Content-Type', r.info.contentType || '');
    detailRow(dl, 'URL (defang)', defang(r.url));
    detailRow(dl, 'Verificado em', fmtDate(r.checkedAt));
    detailRow(dl, 'Cabeçalho detectado na aba', r.info.tabHeading);
    detailRow(dl, 'Trecho visível capturado', r.snippet);
    if (r.info.product) {
      const productDetails = [
        r.info.product.name,
        r.info.product.price && `${r.info.product.currency} ${r.info.product.price}`,
        r.info.product.seller && `vendedor: ${r.info.product.seller}`,
      ].filter(Boolean).join(' · ');
      detailRow(dl, 'Produto/anúncio', productDetails);
    }
    detailRow(dl, 'Descrição', r.info.description);
    detailRow(dl, 'Autor', r.info.author);
    if (r.info.dns) {
      const addresses = r.info.dns.addresses?.length
        ? ` → ${r.info.dns.addresses.join(', ')}`
        : '';
      detailRow(dl, 'DNS', `rcode ${r.info.dns.rcode}${addresses}`);
    }
    detailRow(dl, 'Fallback do modo aba', r.info.tabFallback);
    detailRow(dl, 'Erro do modo aba', r.info.tabError);
    if (r.info.timings) {
      const { analysisMs, enrichmentMs, totalMs } = r.info.timings;
      detailRow(dl, 'Tempo (análise / evidências / total)', `${analysisMs} ms / ${enrichmentMs} ms / ${totalMs} ms`);
    }
    detailRow(dl, 'SHA-256 do conteúdo', r.sha256);
    dl.addEventListener('click', (e) => e.stopPropagation());
    item.appendChild(dl);

    return item;
  }

  function updateSelectionControls() {
    const count = state.selected.size;
    const visible = all().filter(passesFilters);
    const selectedVisible = visible.filter((result) => state.selected.has(result.url)).length;
    $('selectionTools').hidden = count === 0;
    $('selectionCount').textContent = `${count} selecionado${count === 1 ? '' : 's'}`
      + (count > selectedVisible ? ` · ${count - selectedVisible} oculto${count - selectedVisible === 1 ? '' : 's'} pelo filtro` : '');
    $('btnOpenSelected').disabled = count === 0;
    $('bulkClassification').disabled = state.running || count === 0;
    $('btnOpenSelected').textContent = count ? `Abrir selecionados (${count})` : 'Abrir selecionados';
    $('btnOpenSelected').title = count
      ? `Abre em novas abas os ${count} resultados selecionados, inclusive os ocultos pelo filtro.`
      : 'Selecione resultados para abri-los em novas abas.';
    $('btnClearSelection').disabled = count === 0;
    $('btnSelectVisible').disabled = visible.length === 0 || selectedVisible === visible.length;
    $('btnClearVisible').disabled = selectedVisible === 0;
    $('btnSelectVisible').textContent = selectedVisible === visible.length && visible.length
      ? `Visíveis selecionados (${visible.length})`
      : selectedVisible
        ? `Selecionar restantes (${visible.length - selectedVisible})`
        : `Selecionar visíveis (${visible.length})`;
    $('btnSelectVisible').title = selectedVisible
      ? `Seleciona os ${visible.length - selectedVisible} resultados visíveis que ainda não estão selecionados.`
      : `Seleciona os ${visible.length} resultados que passam pelos filtros atuais.`;
    if (count !== state.announcedSelectionCount) {
      $('selectionStatus').textContent = count
        ? `${count} ${count === 1 ? 'link selecionado' : 'links selecionados'}.`
        : 'Nenhum link selecionado.';
      state.announcedSelectionCount = count;
    }
  }

  const CHUNK_SIZE = 50;

  function renderCategory(cat, items) {
    const container = $(cat.section);
    container.textContent = '';
    const header = el('div', 'category-header');
    const left = el('div');
    const title = el('h2', 'category-header-title', cat.title);
    title.id = `${cat.section}-heading`;
    left.appendChild(title);

    const isCollapsed = state.collapsed.has(cat.status);
    const limit = state.displayLimits?.get(cat.status) || CHUNK_SIZE;
    const isChunked = items.length > limit;
    const visibleItems = isChunked ? items.slice(0, limit) : items;

    const subtitleText = isChunked
      ? `Exibindo ${visibleItems.length} de ${items.length} links`
      : `${items.length} link${items.length === 1 ? '' : 's'}`;
    const subtitle = el('p', 'category-subtitle', subtitleText);
    if (cat.status === 'indeterminado' && items.length) {
      const reasonCounts = new Map();
      items.forEach(({ reason }) => reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1));
      const reasons = [...reasonCounts]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, count]) => `${count}× ${reason}`);
      subtitle.textContent += ` · ${reasons.slice(0, 2).join(' · ')}`;
      subtitle.title = `Motivos dos indeterminados: ${reasons.join(' · ')}`;
    }
    left.appendChild(subtitle);
    const meta = el('div', 'category-header-meta');
    const toggle = el('button', 'category-toggle-button', isCollapsed ? 'Expandir' : 'Recolher');
    toggle.type = 'button';
    toggle.title = `${isCollapsed ? 'Mostra' : 'Oculta'} os resultados desta categoria.`;
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.setAttribute('aria-label', `${isCollapsed ? 'Expandir' : 'Recolher'} ${cat.title}`);
    toggle.dataset.focusKey = `category-toggle:${cat.status}`;
    let actionMenu;
    let actionSummary;
    if (items.length) {
      actionMenu = el('details', 'action-menu category-actions-menu');
      actionSummary = el('summary', 'menu-trigger', 'Ações');
      actionSummary.title = `Abrir todos os ${items.length} links desta categoria ou copiá-los.`;
      actionSummary.dataset.focusKey = `category-actions:${cat.status}`;
      const menuContent = el('div', 'menu-content');
      const openAll = el('button', 'btn', 'Abrir todos');
      openAll.type = 'button';
      openAll.setAttribute('aria-label', `Abrir todos os ${items.length} links: ${cat.title}`);
      openAll.title = 'Abre cada URL em uma nova aba; lotes grandes pedem confirmação.';
      const copyAll = el('button', 'btn', 'Copiar todos');
      copyAll.type = 'button';
      copyAll.setAttribute('aria-label', `Copiar todos os ${items.length} links: ${cat.title}`);
      copyAll.title = 'Copia as URLs originais desta categoria, uma por linha.';
      menuContent.append(openAll, copyAll);
      actionMenu.append(actionSummary, menuContent);
      meta.appendChild(actionMenu);
    }
    meta.appendChild(toggle);
    header.append(left, meta);

    const content = el('div', 'category-content');
    content.id = `${cat.section}-content`;
    content.setAttribute('role', 'region');
    content.setAttribute('aria-labelledby', title.id);
    content.classList.toggle('collapsed', isCollapsed);
    content.setAttribute('aria-hidden', String(isCollapsed));
    content.inert = isCollapsed;
    toggle.setAttribute('aria-controls', content.id);
    const contentInner = el('div', 'category-content-inner');
    if (!isCollapsed) {
      if (!items.length) {
        contentInner.appendChild(el('div', 'empty-state', 'Nenhum resultado nesta categoria.'));
      } else {
        const list = el('ul', 'result-list');
        visibleItems.forEach((r) => list.appendChild(createItem(r, cat)));
        contentInner.appendChild(list);

        if (isChunked) {
          const pagination = el('div', 'category-pagination');
          const remaining = items.length - limit;
          const nextCount = Math.min(remaining, CHUNK_SIZE);
          const showMore = el('button', 'btn', `Mostrar mais ${nextCount} (${remaining} restantes)`);
          showMore.type = 'button';
          showMore.dataset.focusKey = `category-more:${cat.status}`;
          showMore.addEventListener('click', (e) => {
            e.stopPropagation();
            state.displayLimits?.set(cat.status, limit + CHUNK_SIZE);
            scheduleRender();
          });
          const showAll = el('button', 'btn', `Mostrar todos os ${items.length}`);
          showAll.type = 'button';
          showAll.dataset.focusKey = `category-all:${cat.status}`;
          showAll.addEventListener('click', (e) => {
            e.stopPropagation();
            state.displayLimits?.set(cat.status, items.length);
            scheduleRender();
          });
          pagination.append(showMore, showAll);
          contentInner.appendChild(pagination);
        }
      }
    }
    content.appendChild(contentInner);
    const toggleCategory = () => {
      const collapsed = !content.classList.contains('collapsed');
      if (collapsed) state.collapsed.add(cat.status);
      else state.collapsed.delete(cat.status);
      scheduleRender();
    };
    header.style.cursor = 'pointer';
    header.addEventListener('click', (event) => {
      if (event.target.closest('button, details')) return;
      toggleCategory();
    });
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleCategory();
    });
    if (actionMenu) {
      actionMenu.addEventListener('click', (event) => event.stopPropagation());
      const [openAll, copyAll] = actionMenu.querySelectorAll('button');
      openAll.addEventListener('click', () => {
        closeActionMenu(actionMenu);
        openUrls(items.map((r) => r.url));
      });
      copyAll.addEventListener('click', async () => {
        closeActionMenu(actionMenu);
        const ok = await copyText(items.map((r) => r.url).join('\n'));
        if (ok) {
          state.copiedUrl = null;
          scheduleRender();
          toast(items.length === 1 ? '1 URL copiada' : `${items.length} URLs copiadas`);
        } else {
          toast('Não foi possível copiar as URLs');
        }
      });
    }
    container.append(header, content);
  }

  $('btnOpenSelected').addEventListener('click', () => {
    const urls = state.order.filter((url) => state.selected.has(url));
    openUrls(urls);
  });
  $('btnClearSelection').addEventListener('click', () => {
    closeActionMenu($('btnClearSelection').closest('details'));
    state.selected.clear();
    $('btnSelectVisible').focus();
    scheduleRender();
    updateSelectionControls();
  });
  $('btnSelectVisible').addEventListener('click', () => {
    all().filter(passesFilters).forEach((result) => state.selected.add(result.url));
    scheduleRender();
    updateSelectionControls();
  });
  $('btnClearVisible').addEventListener('click', () => {
    closeActionMenu($('btnClearVisible').closest('details'));
    all().filter(passesFilters).forEach((result) => state.selected.delete(result.url));
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
    const take = list.filter(hasEffectiveTakedown).length;
    const chg = list.filter((r) => r.changed).length;
    if (take) chips.push(['inativa', `Derrubados: ${take}`]);
    if (chg) chips.push(['indet', `Mudaram de status: ${chg}`]);
    chips.forEach(([c, t, section]) => {
      const chip = el(section ? 'a' : 'span', `chip ${c}`, t);
      chip.title = section ? `Ir para a categoria ${t.toLowerCase()}.` : t;
      if (section) {
        chip.href = `#${section}`;
        chip.dataset.focusKey = `summary:${section}`;
      }
      s.appendChild(chip);
    });
  }

  function render() {
    const list = all();
    if (!list.length) return;
    const active = document.activeElement;
    const focusKey = active?.dataset?.focusKey;
    updateSelectionControls();
    $('resultsSections').style.display = 'block';
    renderSummary(list);
    const filtered = list.filter(passesFilters);
    $('filterSummary').textContent = filtered.length === list.length
      ? `Exibindo ${filtered.length} de ${list.length} resultados.`
      : `Exibindo ${filtered.length} de ${list.length} resultados filtrados.`;
    $('filterEmpty').hidden = filtered.length !== 0;
    CATEGORIES.forEach((cat) => {
      const items = filtered.filter((r) => r.status === cat.status);
      $(cat.section).hidden = items.length === 0;
      renderCategory(cat, items);
    });
    if (focusKey) {
      const replacement = [...document.querySelectorAll('[data-focus-key]')]
        .find((element) => element.dataset.focusKey === focusKey);
      replacement?.focus({ preventScroll: true });
    }
  }

  return { render };
}
