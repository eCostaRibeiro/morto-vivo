import { defang } from './normalize.js';

const KIND_LABEL = { site: 'Site', marketplace: 'Marketplace', social: 'Rede social', messaging: 'Mensageria' };

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
}

export function toCsv(list) {
  const cols = ['url', 'url_defang', 'status', 'motivo', 'status_automatico', 'motivo_automatico', 'classificacao_manual', 'http', 'content_type', 'url_final', 'plataforma', 'tipo', 'titulo', 'derrubado', 'redirect_externo', 'status_anterior', 'mudou', 'verificado_em', 'via', 'fallback_http', 'sha256', 'estacionado'];
  const DANGEROUS_LEAD = /^[=+\-@\t\r]/;
  const esc = (v) => {
    let s = String(v ?? '');
    // Neutraliza fórmulas antes do quoting CSV: aspas não impedem execução em planilhas.
    if (DANGEROUS_LEAD.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = list.map((r) => [
    r.url, defang(r.url), r.status, r.reason, r.automaticStatus || '', r.automaticReason || '',
    r.manualClassification || '', r.httpStatus ?? '', r.info?.contentType || '', r.finalUrl, r.platformName ?? '', r.kind, r.title,
    r.tags.includes('takedown') ? 'sim' : '',
    r.tags.includes('redirect-externo') ? 'sim' : '',
    r.previous ? r.previous.status : '', r.changed ? 'sim' : '', r.checkedAt, r.via,
    r.info?.httpFallback || (r.info?.httpFallbackError ? `Falhou: ${r.info.httpFallbackError}` : ''), r.sha256,
    r.tags.includes('parked') ? 'sim' : '',
  ].map(esc).join(';'));
  return '\uFEFF' + [cols.join(';'), ...rows].join('\r\n');
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildReport(list, generatedAt = new Date().toISOString()) {
  const rows = list.map((r) => `
  <section class="it ${esc(r.status)}">
    <div class="hd">${r.faviconData ? `<img class="fav" src="${esc(r.faviconData)}" alt="">` : ''}
      <div><b>${esc(r.status.toUpperCase())}</b>${r.httpStatus ? ` (HTTP ${esc(r.httpStatus)})` : ''} — ${esc(r.reason)}
      <div class="u">${esc(defang(r.url))}</div>${r.finalUrl && r.finalUrl !== r.url ? `<div class="u">URL final: ${esc(defang(r.finalUrl))}</div>` : ''}
      <div>${esc(r.title)}</div></div></div>
    <ul>
      <li>Verificado em: ${esc(fmtDate(r.checkedAt))} · plataforma: ${esc(r.platformName || '—')} · tipo: ${esc(KIND_LABEL[r.kind] || r.kind)}${r.tags.includes('takedown') ? ' · <b>DERRUBADO/SUSPENSO</b>' : ''}</li>
      ${r.changed && r.previous ? `<li>Mudança: ${esc(r.previous.status)} → ${esc(r.status)} (anterior: ${esc(fmtDate(r.previous.at))})</li>` : ''}
      ${r.manualClassification ? `<li>Classificação manual: ${esc(r.manualClassification)} · automática: ${esc(r.automaticStatus)} — ${esc(r.automaticReason)}</li>` : ''}
      ${r.tags.includes('parked') ? '<li>Domínio estacionado/anunciado para venda; não é confirmação de takedown.</li>' : ''}
      ${r.info?.httpFallback ? `<li>Fallback HTTP: ${esc(r.info.httpFallback)}; confiança limitada a média por usar uma conexão sem criptografia.</li>` : ''}
      ${r.info?.httpFallbackError ? `<li>Fallback HTTP não concluído: ${esc(r.info.httpFallbackError)}</li>` : ''}
      ${r.sha256 ? `<li>SHA-256 do conteúdo: <code>${esc(r.sha256)}</code></li>` : ''}
    </ul>
  </section>`).join('\n');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Morto-Vivo ${esc(fmtDate(generatedAt))}</title>
<style>body{font:14px/1.5 Segoe UI,Roboto,sans-serif;max-width:980px;margin:24px auto;padding:0 16px;color:#1D1B20}
h1{color:#6750A4}.it{border:1px solid #ddd;border-left:6px solid #888;border-radius:8px;padding:12px;margin:14px 0;page-break-inside:avoid}
.it.vivo{border-left-color:#146C2E}.it.zumbi{border-left-color:#E65100}.it.morto{border-left-color:#B3261E}.it.indeterminado{border-left-color:#44546A}
.hd{display:flex;gap:10px;align-items:flex-start}.fav{width:28px;height:28px}.u{font-family:Consolas,monospace;font-size:12px;word-break:break-all;color:#555}
code{font-size:11px;word-break:break-all}ul{margin:6px 0 0 18px;padding:0;font-size:12px}</style></head><body>
<h1>Relatório Morto-Vivo</h1><p>Gerado em ${esc(fmtDate(generatedAt))} · ${list.length} registros. URLs exibidas com defang.</p>${rows}</body></html>`;
}

export function toJson(list) {
  // Favicons embutidos podem inflar muito o arquivo; os demais dados do resultado são mantidos.
  const records = list.map(({ faviconData, screenshot, screenshotError, ...record }) => record);
  return JSON.stringify(records, null, 2);
}
