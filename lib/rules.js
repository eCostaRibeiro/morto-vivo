// Ponto único de acesso ao catálogo de plataformas e aos padrões genéricos de detecção.
// O conteúdo em si (regexes, catálogo por site, sondas de API) vive em lib/platforms/*.js,
// um arquivo por grupo de plataforma — mexa lá quando um site mudar o texto de erro.
// Este arquivo só agrega tudo e resolve qual plataforma corresponde a uma URL.

import {
  TAKEDOWN, PARKED, DOMAIN_SALE, DOMAIN_SALE_CTA, DOMAIN_PARKING_PROVIDERS,
  SOFT404_TITLE, SOFT404_BODY, CHALLENGE, LOGIN_WALL,
} from './platforms/genericPatterns.js';
import { defaultAlive } from './platforms/helpers.js';
import { MARKETPLACE_PLATFORMS } from './platforms/marketplaces.js';
import { SOCIAL_PLATFORMS } from './platforms/social.js';
import { MESSAGING_PLATFORMS } from './platforms/messaging.js';

export {
  TAKEDOWN, PARKED, DOMAIN_SALE, DOMAIN_SALE_CTA, DOMAIN_PARKING_PROVIDERS,
  SOFT404_TITLE, SOFT404_BODY, CHALLENGE, LOGIN_WALL, defaultAlive,
};

export const PLATFORMS = [
  ...MARKETPLACE_PLATFORMS,
  ...SOCIAL_PLATFORMS,
  ...MESSAGING_PLATFORMS,
];

/**
 * Identifica plataforma pelo hostname; URLs do Marketplace do Facebook recebem tipo próprio.
 * Retorna null quando não há regra correspondente.
 */
export function detectPlatform(u) {
  const host = u.hostname.toLowerCase();
  const isFbMarket = /facebook\.com$/.test(host) && /\/marketplace\/item\//.test(u.pathname);
  const p = PLATFORMS.find((pl) => pl.hosts.some((h) => h.test(host)));
  const isFbAdLibrary = p?.id === 'facebook'
    && /^\/ads\/library\/?$/i.test(u.pathname)
    && /^\d+$/.test(u.searchParams.get('id') || '');
  if (isFbAdLibrary) return { ...p, name: 'Meta Ad Library', kind: 'advertisement' };
  if (p && isFbMarket) return { ...p, kind: 'marketplace' };
  return p || null;
}
