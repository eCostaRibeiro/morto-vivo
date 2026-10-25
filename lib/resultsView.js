import { defang } from './normalize.js';

// Keeps DOM rendering and result interactions separate from batch orchestration.
export const CATEGORIES = [
  { status: 'vivo', title: 'Links vivos', cls: 'ativa', section: 'vivoSection', label: 'VIVO' },
  { status: 'zumbi', title: 'Links zumbis', cls: 'erro', section: 'zumbiSection', label: 'ZUMBI' },
  { status: 'morto', title: 'Links mortos', cls: 'inativa', section: 'mortoSection', label: 'MORTO' },
  { status: 'indeterminado', title: 'Indeterminados (verificar manualmente)', cls: 'indet', section: 'indetSection', label: 'INDETERMINADO' },
];
const KIND_LABEL = { site: 'Site', marketplace: 'Marketplace', social: 'Rede social', messaging: 'Mensageria' };

export function closeActionMenu(menu) {
  if (!menu) return;
  menu.open = false;
  menu.querySelector(':scope > summary')?.focus();
}

export function createResultsView({ state, scheduleRender, runChecks, openUrls, copyText, toast }) {
  const $ = (id) => document.getElementById(id);
  const all = () => state.order.map((url) => state.results.get(url)).filter(Boolean);

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
    if (r.changed && r.previous) {
      const previousStatus = r.previous.status.toUpperCase();
      const currentStatus = r.status.toUpperCase();
      badges.appendChild(badge(
        `${previousStatus} → ${currentStatus} (antes: ${fmtDate(r.previous.at)})`,
        'changed',
      ));
    }
    if (r.via !== 'fetch') badges.appendChild(badge(r.via === 'tab' ? 'via aba' : 'via API'));
    else if (r.info.tabAttempted) badges.appendChild(badge('modo aba tentado'));
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
      dl.hidden = !isOpen;
      more.setAttribute('aria-expanded', String(isOpen));
      more.setAttribute('aria-label', `${isOpen ? 'Ocultar' : 'Mostrar'} detalhes: ${r.title || r.url}`);
      if (isOpen) state.open.add(r.url); else state.open.delete(r.url);
    });
    const copy = el('button', 'btn-mini', 'Copiar URL');
    copy.type = 'button';
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
    const moreSummary = el('summary', 'menu-trigger', 'Mais');
    moreSummary.dataset.focusKey = `more:${r.url}`;
    moreMenu.appendChild(moreSummary);
    const moreContent = el('div', 'menu-content');
    moreContent.appendChild(more);
    moreMenu.appendChild(moreContent);
    actions.append(selectLabel, open, copy, rerun, moreMenu);
    card.appendChild(actions);
    item.appendChild(card);

    const dl = el('dl', 'details');
    dl.id = detailsId;
    dl.hidden = !state.open.has(r.url);
    detailRow(dl, 'URL final', r.finalUrl && r.finalUrl !== r.url ? r.finalUrl : '');
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
    $('btnOpenSelected').textContent = count ? `Abrir selecionados (${count})` : 'Abrir selecionados';
    $('btnClearSelection').disabled = count === 0;
    $('btnSelectVisible').disabled = visible.length === 0 || selectedVisible === visible.length;
    $('btnClearVisible').disabled = selectedVisible === 0;
    $('btnSelectVisible').textContent = selectedVisible === visible.length && visible.length
      ? `Visíveis selecionados (${visible.length})`
      : selectedVisible
        ? `Selecionar restantes (${visible.length - selectedVisible})`
        : `Selecionar visíveis (${visible.length})`;
    if (count !== state.announcedSelectionCount) {
      $('selectionStatus').textContent = count
        ? `${count} ${count === 1 ? 'link selecionado' : 'links selecionados'}.`
        : 'Nenhum link selecionado.';
      state.announcedSelectionCount = count;
    }
  }

  function renderCategory(cat, items) {
    const container = $(cat.section);
    container.textContent = '';
    const header = el('div', 'category-header');
    const left = el('div');
    const title = el('h2', 'category-header-title', cat.title);
    title.id = `${cat.section}-heading`;
    left.appendChild(title);
    left.appendChild(el('p', 'category-subtitle', `${items.length} link${items.length === 1 ? '' : 's'}`));
    const meta = el('div', 'category-header-meta');
    const isCollapsed = state.collapsed.has(cat.status);
    const toggle = el('button', 'category-toggle-button', isCollapsed ? 'Expandir' : 'Recolher');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    toggle.setAttribute('aria-label', `${isCollapsed ? 'Expandir' : 'Recolher'} ${cat.title}`);
    toggle.dataset.focusKey = `category-toggle:${cat.status}`;
    let actionMenu;
    let actionSummary;
    if (items.length) {
      actionMenu = el('details', 'action-menu category-actions-menu');
      actionSummary = el('summary', 'menu-trigger', 'Ações');
      actionSummary.dataset.focusKey = `category-actions:${cat.status}`;
      const menuContent = el('div', 'menu-content');
      const openAll = el('button', 'btn', 'Abrir todos');
      openAll.type = 'button';
      openAll.setAttribute('aria-label', `Abrir todos os ${items.length} links: ${cat.title}`);
      const copyAll = el('button', 'btn', 'Copiar todos');
      copyAll.type = 'button';
      copyAll.setAttribute('aria-label', `Copiar todos os ${items.length} links: ${cat.title}`);
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
    content.hidden = isCollapsed;
    toggle.setAttribute('aria-controls', content.id);
    if (!items.length) {
      content.appendChild(el('div', 'empty-state', 'Nenhum resultado nesta categoria.'));
    } else {
      const list = el('ul', 'result-list');
      items.forEach((r) => list.appendChild(createItem(r, cat)));
      content.appendChild(list);
    }
    const toggleCategory = () => {
      const collapsed = !content.hidden;
      content.hidden = collapsed;
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? 'Expandir' : 'Recolher';
      toggle.setAttribute('aria-label', `${collapsed ? 'Expandir' : 'Recolher'} ${cat.title}`);
      if (collapsed) state.collapsed.add(cat.status); else state.collapsed.delete(cat.status);
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
    const take = list.filter((r) => r.tags.includes('takedown')).length;
    const chg = list.filter((r) => r.changed).length;
    if (take) chips.push(['inativa', `Derrubados: ${take}`]);
    if (chg) chips.push(['indet', `Mudaram de status: ${chg}`]);
    chips.forEach(([c, t, section]) => {
      const chip = el(section ? 'a' : 'span', `chip ${c}`, t);
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
