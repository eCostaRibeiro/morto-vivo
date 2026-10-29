// Catálogo de marketplaces (Mercado Livre, OLX, Shopee, Amazon, Magalu, Enjoei, Americanas).

import { gen } from './helpers.js';

const MARKET_DEAD = [
  { re: /(anuncio|publicacao|produto|item|oferta)s? (ja )?(foi|esta|estao) (removid|finalizad|encerrad|expirad|desativad|excluid)\w*/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /(anuncio|publicacao|oferta) (removid|finalizad|encerrad|expirad|desativad|excluid)\w*/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /nao esta mais (disponivel|a venda|ativ[oa])|nao existe mais|(anuncio|publicacao|produto|pagina) nao (existe|foi encontrad[oa])/, status: 'morto', reason: 'Anúncio inexistente/indisponível' },
  { re: /(anuncio|publicacao) (foi |esta )?pausad\w*/, status: 'zumbi', reason: 'Anúncio pausado' },
  { re: /(loja|vendedor|perfil|usuario) (nao existe|foi (removid|suspens|bloquead|desativad)\w*|(suspens|bloquead|desativad)\w*)/, status: 'morto', reason: 'Loja/vendedor removido ou suspenso' },
  { re: /(listing|item|ad) (is )?(no longer available|isn't available anymore|has been (removed|deleted))/, status: 'morto', reason: 'Anúncio removido/encerrado' },
  { re: /(produto|item) (temporariamente )?indisponivel/, status: 'zumbi', reason: 'Produto indisponível' },
];

/* ---------- Sondas por API pública (respostas definitivas) ---------- */

async function shopeeProbe(u, { getJson }) {
  const m = u.pathname.match(/\/product\/(\d+)\/(\d+)/) || u.pathname.match(/-i\.(\d+)\.(\d+)/);
  if (!m) return null;
  // Melhor esforço: a Shopee costuma bloquear essa chamada sem tokens anti-bot.
  const r = await getJson(`https://${u.hostname}/api/v4/item/get?itemid=${m[2]}&shopid=${m[1]}`);
  const d = r.json && r.json.data;
  if (r.status === 200 && d && (d.itemid || d.item_id) && d.name) {
    if (d.stock === 0 || d.stock === '0') {
      return {
        status: 'morto',
        reason: 'Produto esgotado na Shopee',
        confidence: 'alta',
        tags: ['out-of-stock'],
      };
    }
    return { status: 'vivo', reason: 'Produto encontrado (API Shopee)', confidence: 'alta', title: d.name, price: d.price ? d.price / 100000 : '' };
  }
  return null;
}

/* ---------- Catálogo ---------- */

export const MARKETPLACE_PLATFORMS = [
  gen('mercadolivre', 'Mercado Livre', 'marketplace', [/(^|\.)mercadoli(vre|bre)\.com(\.[a-z]{2})?$/, /^meli\.la$/], {
    dead: MARKET_DEAD,
    item: (u) => /\bMLB-?\d{6,}/i.test(u.pathname) || /\/p\/MLB\d+/.test(u.pathname),
  }),
  gen('olx', 'OLX', 'marketplace', [/(^|\.)olx\.com\.br$/], {
    dead: MARKET_DEAD,
    item: (u) => /-\d{7,}\/?$/.test(u.pathname),
  }),
  gen('shopee', 'Shopee', 'marketplace', [/(^|\.)shopee\.com(\.br)?$/, /^shp\.ee$/], {
    dead: [...MARKET_DEAD, { re: /(este )?produto (nao existe|nao esta disponivel|indisponivel)|this product (doesn't exist|is unavailable)/, status: 'morto', reason: 'Produto inexistente/indisponível' }],
    item: (u) => /\/product\/\d+\/\d+/.test(u.pathname) || /-i\.\d+\.\d+/.test(u.pathname),
    needsBrowser: true, requireAlive: true, probe: shopeeProbe,
  }),
  gen('amazon', 'Amazon', 'marketplace', [/(^|\.)amazon\.com\.br$/], {
    dead: [...MARKET_DEAD, { re: /nao conseguimos encontrar essa pagina|looking for something\? we're sorry/, status: 'morto', reason: 'Página inexistente' }],
    item: (u) => /\/(dp|gp\/product)\/[A-Z0-9]{10}/i.test(u.pathname),
  }),
  gen('magalu', 'Magazine Luiza', 'marketplace', [/(^|\.)magazineluiza\.com\.br$/, /(^|\.)magalu\.com$/], { dead: MARKET_DEAD, item: (u) => /\/p\/[a-z0-9]+\/?/i.test(u.pathname) }),
  gen('enjoei', 'Enjoei', 'marketplace', [/(^|\.)enjoei\.com\.br$/], { dead: MARKET_DEAD, item: (u) => /\/p\//.test(u.pathname) }),
  gen('americanas', 'Americanas', 'marketplace', [/(^|\.)americanas\.com\.br$/], { dead: MARKET_DEAD, item: (u) => /\/produto\//.test(u.pathname) }),
];
