// Catálogo de mensageria (Telegram, WhatsApp, Discord).

import { norm } from '../text.js';
import { gen } from './helpers.js';
import { SOCIAL_DEAD } from './social.js';

/* ---------- Sondas por API pública (respostas definitivas) ---------- */

async function discordProbe(u, { getJson }) {
  const code = u.pathname.split('/').filter(Boolean).pop();
  if (!code) return null;
  const r = await getJson(`https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true`);
  if (r.status === 200 && r.json) return { status: 'vivo', reason: 'Convite válido', confidence: 'alta', title: r.json.guild?.name || r.json.channel?.name || '' };
  if (r.status === 404) return { status: 'morto', reason: 'Convite inexistente/expirado', confidence: 'alta' };
  return null;
}

/* ---------- Catálogo ---------- */

export const MESSAGING_PLATFORMS = [
  gen('telegram', 'Telegram', 'messaging', [/^(t|telegram)\.me$/], {
    dead: SOCIAL_DEAD, requireAlive: true,
    // t.me/<usuario>: página real traz .tgme_page_extra (ex.: "@user" ou "N membros").
    alive: (meta, { html }) => /tgme_page_extra|tgme_page_photo/.test(html),
    deadFn: (meta, { html }) => (/^telegram: contact @/i.test(meta.og['og:title'] || meta.title || '') && !/tgme_page_extra/.test(html))
      ? { status: 'morto', reason: 'Username sem página pública (inexistente/banido?)', confidence: 'média' } : null,
  }),
  gen('whatsapp-invite', 'WhatsApp (grupo)', 'messaging', [/^chat\.whatsapp\.com$/], {
    dead: SOCIAL_DEAD, requireAlive: true,
    alive: (meta) => !!meta.og['og:title'] && !/^whatsapp (group )?invite$|^convite/i.test(norm(meta.og['og:title'])),
  }),
  gen('whatsapp-link', 'WhatsApp (wa.me)', 'messaging', [/^wa\.me$/, /^api\.whatsapp\.com$/], {
    // Link de clique-para-conversar: a página abre mesmo se o número não existir.
    static: { status: 'indeterminado', reason: 'Link wa.me/click-to-chat não revela se o número existe', confidence: 'alta' },
  }),
  gen('discord', 'Discord', 'messaging', [/^discord\.gg$/, /(^|\.)discord\.com$/], { dead: SOCIAL_DEAD, requireAlive: true, probe: discordProbe }),
];
