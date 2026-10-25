import assert from 'node:assert/strict';
import test from 'node:test';

import {
  customRulesToCsv, normalizeCustomRuleTerm, parseCustomRules, parseCustomRulesCsv,
  validateCustomRules,
} from '../lib/customRules.js';

test('parses literal classification rules and ignores blank/comment lines', () => {
  assert.deepEqual(parseCustomRules(
    '# regras locais\n\nmorto | Anúncio removido\nzumbi | manutenção\nvivo | produto disponível',
  ), {
    rules: [
      { status: 'morto', term: 'Anúncio removido' },
      { status: 'zumbi', term: 'manutenção' },
      { status: 'vivo', term: 'produto disponível' },
    ],
    error: '',
  });
});

test('rejects malformed custom rules with a line-specific explanation', () => {
  assert.match(parseCustomRules('morto anúncio removido').error, /Linha 1: use o formato/);
  assert.match(parseCustomRules('unknown | conteúdo removido').error, /status inválido/);
  assert.match(parseCustomRules('vivo | x').error, /de 2 a 1000 caracteres/);
});

test('accepts more than 50 custom rules', () => {
  const input = Array(75).fill('morto | página removida').join('\n');
  const parsed = parseCustomRules(input);
  assert.equal(parsed.error, '');
  assert.equal(parsed.rules.length, 75);
});

test('normalizes pasted multi-line terms and Markdown links for matching', () => {
  const term = `Copyright © 1999-2026 GoDaddy, LLC. Todos os direitos reservados.
Aviso de isenção de responsabilidade: as referências a qualquer empresa, produto ou serviço neste Site não são controladas pela GoDaddy.com LLC e não constituem ou implicam sua associação a esses terceiros ou seu endosso deles.
[Política de Privacidade](https://example.com/privacy)`;
  const parsed = validateCustomRules([{ status: 'morto', term }]);
  assert.equal(parsed.error, '');
  assert.equal(parsed.rules[0].term, 'Copyright © 1999-2026 GoDaddy, LLC. Todos os direitos reservados. Aviso de isenção de responsabilidade: as referências a qualquer empresa, produto ou serviço neste Site não são controladas pela GoDaddy.com LLC e não constituem ou implicam sua associação a esses terceiros ou seu endosso deles. Política de Privacidade');
  assert.equal(normalizeCustomRuleTerm('  linha um\nlinha dois  '), 'linha um linha dois');
});

test('rejects custom rule terms longer than the editor limit', () => {
  const parsed = validateCustomRules([{ status: 'morto', term: 'x'.repeat(1001) }]);
  assert.match(parsed.error, /Regra 1: o termo precisa ter de 2 a 1000 caracteres/);
});

test('exports custom rules as UTF-8 CSV with escaped fields and formula protection', () => {
  const csv = customRulesToCsv([
    { status: 'morto', term: 'produto, "removido"; confirmado' },
    { status: 'vivo', term: '=HYPERLINK("https://bad.example")' },
  ]);
  assert.equal(csv, '\uFEFFstatus;frase\r\n'
    + '"morto";"produto, ""removido""; confirmado"\r\n'
    + '"vivo";"\'=HYPERLINK(""https://bad.example"")"');
});

test('imports exported CSV with quoted delimiters, accents, and formula-safe terms', () => {
  const rules = [
    { status: 'morto', term: 'produto, "removido"; confirmado' },
    { status: 'vivo', term: '=HYPERLINK("https://bad.example")' },
  ];
  assert.deepEqual(parseCustomRulesCsv(customRulesToCsv(rules)), { rules, error: '' });
});

test('rejects invalid CSV without returning partially imported rules', () => {
  assert.match(parseCustomRulesCsv('status,frase\nmorto,x').error, /Cabeçalho inválido/);
  assert.match(parseCustomRulesCsv('status;frase\nmorto').error, /Linha 2: esperado duas colunas/);
  assert.match(parseCustomRulesCsv('status;frase\nunknown;frase inválida').error, /Linha 2: status inválido/);
  assert.match(parseCustomRulesCsv('status;frase\nmorto;"aspas abertas').error, /aspas não fechadas/);
});
