// Catálogo de redes sociais (Instagram, Facebook, X, TikTok, YouTube, Bluesky, Threads,
// LinkedIn, Kwai, Reddit, Pinterest).

import { gen, defaultAlive } from './helpers.js';

const SOCIAL_DEAD = [
  // Facebook usa regras próprias em analyzer.js porque indisponibilidade pode ser privacidade/login.
  { re: /(esta |this )?(pagina|page) (nao (esta )?disponivel|indisponivel|isn't available|not found|nao encontrada|nao foi encontrada)|sorry, this page isn't available/, status: 'morto', reason: 'Página/perfil indisponível' },
  { re: /(este |this )?conteudo (nao (esta )?disponivel|indisponivel|isn't available)|this content isn't available/, status: 'morto', reason: 'Conteúdo indisponível' },
  { re: /(conta|account) (suspensa|suspended)|essa conta (nao existe|foi suspensa)|this account (doesn't exist|has been suspended)/, status: 'morto', reason: 'Conta suspensa/inexistente' },
  { re: /couldn't find this account|nao foi possivel encontrar esta conta|hmm\.{0,3} ?this page doesn't exist|essa pagina nao existe/, status: 'morto', reason: 'Conta/página inexistente' },
  { re: /(video|post|publicacao|reel) (indisponivel|nao esta disponivel|removido)|video currently unavailable|this video isn't available|this post isn't available/, status: 'morto', reason: 'Vídeo/post indisponível' },
  { re: /(o )?link (que voce seguiu|que voce acessou|you followed) (pode estar|may be) (quebrado|broken)|o link que voce acessou pode estar quebrado ou a pagina pode ter sido removida|the link you followed may be broken, or the page may have been removed/, status: 'morto', reason: 'Link quebrado / conteúdo removido' },
  { re: /this (post|tweet) (was deleted|has been deleted|is unavailable)|este (post|tweet|publicacao) (foi (apagad|excluid)[oa]|esta indisponivel)/, status: 'morto', reason: 'Post/tweet apagado ou indisponível' },
  { re: /invite link (is )?(invalid|revoked|expired|reset)|link de convite (e |foi |esta )?(invalido|revogado|expirou|redefinido)|convite.{0,30}(invalido|expirado)/, status: 'morto', reason: 'Convite inválido/revogado/expirado' },
  { re: /(this )?(channel|canal) (has been terminated|foi encerrado|nao esta disponivel|isn't available)|conta do youtube.{0,30}(encerrada|terminated)/, status: 'morto', reason: 'Canal encerrado/indisponível' },
  { re: /account has been (deactivated|taken down)|profile not found|post not found/, status: 'morto', reason: 'Conta ou conteúdo removido/inexistente' },
];

/* ---------- Sondas por API pública (respostas definitivas) ---------- */

async function ytProbe(u, { getJson }) {
  if (!/youtu\.be\/|\/(?:watch|shorts|live|embed)\b/.test(u.href)) return null;
  const r = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Vídeo disponível (oEmbed)', confidence: 'alta', title: r.json.title, author: r.json.author_name };
  if (r.status === 404 || r.status === 400) return { status: 'morto', reason: 'Vídeo removido/inexistente (oEmbed 404)', confidence: 'alta' };
  if (r.status === 401 || r.status === 403) return { status: 'indeterminado', reason: 'Vídeo privado ou com embed desativado', confidence: 'média' };
  return null;
}

async function xProbe(u, { getJson }) {
  if (!/\/status(es)?\/\d+/.test(u.pathname)) return null;
  const target = new URL(u.href);
  target.hostname = 'twitter.com';
  const r = await getJson(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(target.href)}`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Post disponível (oEmbed)', confidence: 'alta', title: r.json.author_name ? `Post de ${r.json.author_name}` : '', author: r.json.author_name };
  if (r.status === 404) return { status: 'morto', reason: 'Post removido ou conta suspensa (oEmbed 404)', confidence: 'alta' };
  return null;
}

async function tiktokProbe(u, { getJson }) {
  const videoId = u.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/)?.[1];
  const isShortUrl = /^(?:vm|vt)\.tiktok\.com$/i.test(u.hostname);
  if (!videoId && !isShortUrl) return null;
  const r = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u.href)}`);
  const challenge = /captcha|verify (?:you are|to continue)|too many requests|please wait|unusual traffic|security check|rate limit/i
    .test(r.text || '');
  if (r.status === 429 || (r.status === 403 && challenge)) {
    return {
      status: 'indeterminado',
      reason: `TikTok limitou ou desafiou a consulta (HTTP ${r.status}); a fila da plataforma será pausada`,
      confidence: 'baixa',
      tags: ['anti-bot'],
      httpStatus: r.status,
      stopFurtherChecks: true,
    };
  }
  if (r.status === 200 && r.json?.type === 'video'
      && (!videoId || String(r.json.embed_product_id) === videoId)) {
    return {
      status: 'vivo',
      reason: 'Vídeo disponível (oEmbed)',
      confidence: 'alta',
      title: r.json.title || '',
      author: r.json.author_name,
    };
  }
  return null;
}

async function bskyProbe(u, { getJson }) {
  const postMatch = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
  if (postMatch) {
    const [, actor, rkey] = postMatch;
    const r = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://${encodeURIComponent(actor)}/app.bsky.feed.post/${encodeURIComponent(rkey)}&depth=0`);
    if (r.status === 200 && r.json?.thread) {
      const type = r.json.thread.$type;
      if (type === 'app.bsky.feed.defs#threadViewPost') {
        const author = r.json.thread.post?.author?.handle || actor;
        const text = (r.json.thread.post?.record?.text || '').trim();
        return {
          status: 'vivo',
          reason: 'Post disponível no Bluesky',
          confidence: 'alta',
          title: text ? `${author}: ${text.slice(0, 120)}` : `Post de @${author}`,
          author,
        };
      }
      if (type === 'app.bsky.feed.defs#notFoundPost') {
        return { status: 'morto', reason: 'Post removido ou inexistente no Bluesky', confidence: 'alta' };
      }
      if (type === 'app.bsky.feed.defs#blockedPost') {
        return { status: 'indeterminado', reason: 'Post restrito ou autor bloqueado no Bluesky', confidence: 'média' };
      }
    }
    if (r.status === 400 || r.status === 404) {
      return { status: 'morto', reason: 'Post removido ou inexistente no Bluesky (404)', confidence: 'alta' };
    }
    return null;
  }

  const profileMatch = u.pathname.match(/^\/profile\/([^/]+)\/?$/);
  if (profileMatch) {
    const actor = profileMatch[1];
    const r = await getJson(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
    if (r.status === 200 && r.json && r.json.handle) {
      const title = r.json.displayName ? `${r.json.displayName} (@${r.json.handle})` : `@${r.json.handle}`;
      return {
        status: 'vivo',
        reason: 'Perfil público encontrado no Bluesky',
        confidence: 'alta',
        title,
        author: r.json.handle,
      };
    }
    if (r.status === 400 || r.status === 404) {
      const msg = `${r.json?.error || ''} ${r.json?.message || ''}`;
      const isSuspended = /takedown|deactivat|suspend/i.test(msg);
      return {
        status: 'morto',
        reason: isSuspended ? 'Conta suspensa ou desativada no Bluesky' : 'Perfil inexistente no Bluesky (404)',
        confidence: 'alta',
      };
    }
    return null;
  }

  return null;
}

function facebookAlive(meta, { textN, platform }) {
  return defaultAlive(meta, { platform }) && textN.length >= 80;
}

/* ---------- Catálogo ---------- */

export const SOCIAL_PLATFORMS = [
  gen('instagram', 'Instagram', 'social', [/(^|\.)instagram\.com$/, /^instagr\.am$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true }),
  gen('facebook', 'Facebook', 'social', [/(^|\.)facebook\.com$/, /^fb\.(com|me|watch)$/, /(^|\.)fb\.com$/], {
    dead: [
      { re: /(?:this|the) (?:page|profile|account|post|video) (?:has been |was )?(?:removed|deleted|disabled|deactivated|suspended)|(?:page|profile|account) (?:not found|doesn.t exist|does not exist)|(?:pagina|perfil|conta) (?:foi )?(?:removida|excluida|desativada|suspensa)|(?:pagina|perfil|conta) nao (?:existe|encontrad[oa])/, status: 'morto', reason: 'Página/perfil removido ou inexistente' },
      { re: /(este|this) (anuncio|listing) (nao esta mais disponivel|isn't available anymore|is no longer available)/, status: 'morto', reason: 'Anúncio do Marketplace removido' },
    ],
    needsBrowser: true, requireAlive: true, alive: facebookAlive,
  }),
  gen('x', 'X (Twitter)', 'social', [/(^|\.)(x|twitter)\.com$/, /^t\.co$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true, probe: xProbe }),
  gen('tiktok', 'TikTok', 'social', [/(^|\.)tiktok\.com$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true, probe: tiktokProbe }),
  gen('youtube', 'YouTube', 'social', [/(^|\.)youtube\.com$/, /^youtu\.be$/], { dead: SOCIAL_DEAD, requireAlive: true, probe: ytProbe }),
  gen('bluesky', 'Bluesky', 'social', [/(^|\.)bsky\.app$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true, probe: bskyProbe }),
  gen('threads', 'Threads', 'social', [/(^|\.)threads\.(net|com)$/], { dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true }),
  gen('linkedin', 'LinkedIn', 'social', [/(^|\.)linkedin\.com$/], {
    dead: SOCIAL_DEAD, needsBrowser: true, requireAlive: true,
    tabSafe: false, // abrir perfis com a sua conta logada notifica "quem viu seu perfil"
  }),
  gen('kwai', 'Kwai', 'social', [/(^|\.)kwai(-video)?\.com$/], { dead: SOCIAL_DEAD, requireAlive: true }),
  gen('reddit', 'Reddit', 'social', [/(^|\.)reddit\.com$/], { dead: SOCIAL_DEAD, requireAlive: true }),
  gen('pinterest', 'Pinterest', 'social', [/(^|\.)pinterest\.(com|com\.br)$/], { dead: SOCIAL_DEAD, requireAlive: true }),
];

export { SOCIAL_DEAD };
