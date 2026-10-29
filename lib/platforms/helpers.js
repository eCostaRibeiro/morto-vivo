// Utilitários compartilhados pelos catálogos de plataforma (lib/platforms/*.js) e por lib/rules.js.

import { norm } from '../text.js';

/** Monta a entrada de catálogo de uma plataforma a partir dos campos comuns + extras específicos. */
export const gen = (id, name, kind, hosts, extra = {}) => ({ id, name, kind, hosts, ...extra });

/** Título "genérico" (shell/login) não prova que o conteúdo existe. */
export function defaultAlive(meta, { platform }) {
  const t = norm(meta.og['og:title'] || meta.title || '');
  if (!t) return false;
  const names = [platform.name, platform.id, 'x', 'tiktok', 'twitter', 'bluesky', 'bsky'].map(norm);
  if (names.includes(t)) return false;
  if (/(log ?in|entrar|sign (in|up)|cadastr|inscreva)/.test(t)) return false;
  if (/make your day|just a moment/.test(t)) return false;
  return true;
}
