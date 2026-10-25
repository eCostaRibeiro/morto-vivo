import { normalizeUrl } from './normalize.js';

export const MAX_IMPORTED_URLS = 500;
export const MAX_IMPORT_FILE_BYTES = 1024 * 1024;

export function parseUrlList(text) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;

  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    const url = normalizeUrl(value);
    if (!url) invalid.push(value);
    else if (seen.has(url)) duplicates++;
    else {
      seen.add(url);
      valid.push(url);
    }
  }

  return { valid, invalid, duplicates };
}
