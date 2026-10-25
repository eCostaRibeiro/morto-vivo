import { norm } from './text.js';

export const CUSTOM_RULE_STATUSES = ['vivo', 'zumbi', 'morto'];
export const MAX_CUSTOM_TERM_LENGTH = 1000;

export function normalizeCustomRuleTerm(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+[^)]*\)/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateCustomRules(input) {
  const rules = [];
  for (const [index, rule] of input.entries()) {
    const status = String(rule?.status ?? '').trim().toLowerCase();
    const term = normalizeCustomRuleTerm(rule?.term);
    if (!CUSTOM_RULE_STATUSES.includes(status)) {
      return { rules: [], error: `Regra ${index + 1}: status inválido; use vivo, zumbi ou morto.` };
    }
    const normalizedTerm = norm(term);
    if (normalizedTerm.length < 2 || normalizedTerm.length > MAX_CUSTOM_TERM_LENGTH) {
      return {
        rules: [],
        error: `Regra ${index + 1}: o termo precisa ter de 2 a ${MAX_CUSTOM_TERM_LENGTH} caracteres.`,
      };
    }
    rules.push({ status, term });
  }
  return { rules, error: '' };
}

export function normalizeCustomRules(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((rule) => rule && CUSTOM_RULE_STATUSES.includes(rule.status)
      && typeof rule.term === 'string')
    .map((rule) => ({ status: rule.status, term: normalizeCustomRuleTerm(rule.term) }))
    .filter((rule) => {
      const normalizedTerm = norm(rule.term);
      return normalizedTerm.length >= 2 && normalizedTerm.length <= MAX_CUSTOM_TERM_LENGTH;
    });
}

export function parseCustomRules(value) {
  const rules = [];
  const lines = String(value ?? '').split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('|');
    if (separator < 0) {
      return { rules: [], error: `Linha ${index + 1}: use o formato status | termo.` };
    }
    const status = line.slice(0, separator).trim().toLowerCase();
    const term = normalizeCustomRuleTerm(line.slice(separator + 1));
    if (!CUSTOM_RULE_STATUSES.includes(status)) {
      return { rules: [], error: `Linha ${index + 1}: status inválido; use vivo, zumbi ou morto.` };
    }
    const normalizedTerm = norm(term);
    if (normalizedTerm.length < 2 || normalizedTerm.length > MAX_CUSTOM_TERM_LENGTH) {
      return {
        rules: [],
        error: `Linha ${index + 1}: o termo precisa ter de 2 a ${MAX_CUSTOM_TERM_LENGTH} caracteres.`,
      };
    }
    rules.push({ status, term });
  }
  return { rules, error: '' };
}

export function customRulesToCsv(rules) {
  const dangerousLead = /^[=+\-@\t\r]/;
  const escape = (value) => {
    let text = String(value ?? '');
    if (dangerousLead.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const rows = rules.map(({ status, term }) => [status, term].map(escape).join(';'));
  return `\uFEFF${['status;frase', ...rows].join('\r\n')}`;
}

export function parseCustomRulesCsv(value) {
  const text = String(value ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
    } else if (closedQuote && char === ';') {
      row.push(field);
      field = '';
      closedQuote = false;
    } else if (closedQuote && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      closedQuote = false;
    } else if (closedQuote && /\s/.test(char)) {
      continue;
    } else if (closedQuote) {
      return { rules: [], error: 'CSV inválido: há texto após o fechamento de aspas.' };
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === '"') {
      return { rules: [], error: 'CSV inválido: aspas em posição inesperada.' };
    } else if (char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) return { rules: [], error: 'CSV inválido: há um campo com aspas não fechadas.' };
  if (closedQuote || field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmptyRows = rows.filter((cells) => cells.some((cell) => cell.trim()));
  rows.length = 0;
  rows.push(...nonEmptyRows);
  if (!rows.length) return { rules: [], error: 'O arquivo CSV está vazio.' };
  if (rows[0].length !== 2
    || rows[0][0].trim().toLowerCase() !== 'status'
    || rows[0][1].trim().toLowerCase() !== 'frase') {
    return { rules: [], error: 'Cabeçalho inválido. Use as colunas status;frase.' };
  }

  const rules = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    if (cells.length !== 2) {
      return { rules: [], error: `Linha ${index + 2}: esperado duas colunas (status e frase).` };
    }
    const [rawStatus, rawTerm] = cells;
    const status = rawStatus.trim().toLowerCase();
    const term = rawTerm.replace(/^'(?=[=+\-@\t\r])/, '').trim();
    if (term.includes('\n') || term.includes('\r')) {
      return { rules: [], error: `Linha ${index + 2}: a frase não pode conter quebras de linha.` };
    }
    const parsed = parseCustomRules(`${status} | ${term}`);
    if (parsed.error) {
      return { rules: [], error: parsed.error.replace('Linha 1', `Linha ${index + 2}`) };
    }
    rules.push(...parsed.rules);
  }
  return { rules, error: '' };
}
