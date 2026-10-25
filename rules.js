import {
  CUSTOM_RULE_STATUSES, MAX_CUSTOM_TERM_LENGTH, customRulesToCsv,
  parseCustomRules, parseCustomRulesCsv, validateCustomRules,
} from './lib/customRules.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './lib/history.js';
import { installButtonSoundFeedback } from './lib/audioFeedback.js';

const $ = (id) => document.getElementById(id);
const labels = { vivo: 'Vivo', zumbi: 'Zumbi', morto: 'Morto' };
let rules = [];
let savedRules = [];

installButtonSoundFeedback();

function setMessage(text, type = '') {
  const message = $('message');
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function updateCount() {
  $('ruleCount').textContent = `${rules.length} ${rules.length === 1 ? 'regra' : 'regras'}`;
}

function renderRules() {
  const list = $('rulesList');
  list.textContent = '';
  $('emptyState').hidden = rules.length > 0;

  rules.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'rule-row';

    const statusLabel = document.createElement('label');
    statusLabel.textContent = `Status da regra ${index + 1}`;
    const status = document.createElement('select');
    status.setAttribute('aria-label', `Status da regra ${index + 1}`);
    CUSTOM_RULE_STATUSES.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labels[value];
      status.appendChild(option);
    });
    status.value = rule.status;
    status.addEventListener('change', () => {
      rules[index].status = status.value;
      setMessage('');
    });
    statusLabel.appendChild(status);

    const termLabel = document.createElement('label');
    termLabel.textContent = `Frase literal ${index + 1}`;
    const term = document.createElement('textarea');
    term.rows = 2;
    term.maxLength = MAX_CUSTOM_TERM_LENGTH;
    term.value = rule.term;
    term.placeholder = 'Ex.: anúncio removido';
    term.setAttribute('aria-label', `Frase literal da regra ${index + 1}`);
    term.addEventListener('input', () => {
      rules[index].term = term.value;
      setMessage('');
    });
    termLabel.appendChild(term);

    const remove = document.createElement('button');
    remove.className = 'button remove';
    remove.type = 'button';
    remove.textContent = 'Remover';
    remove.title = `Remove a regra ${index + 1}`;
    remove.addEventListener('click', () => {
      rules.splice(index, 1);
      renderRules();
      setMessage('Regra removida da edição. Salve para aplicar a alteração.', 'success');
    });
    row.append(statusLabel, termLabel, remove);
    list.appendChild(row);
  });
  updateCount();
}

$('btnAddRule').addEventListener('click', () => {
  rules.push({ status: 'morto', term: '' });
  renderRules();
  $('rulesList').lastElementChild?.querySelector('textarea')?.focus();
  setMessage('Preencha o status e a frase literal antes de salvar.');
});

$('btnExportRules').addEventListener('click', () => {
  if (!savedRules.length) {
    setMessage('Não há regras salvas para exportar.', 'error');
    return;
  }
  const blob = new Blob([customRulesToCsv(savedRules)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `morto-vivo-regras-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setMessage('CSV exportado com as regras salvas.', 'success');
});

$('rulesCsvFile').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    setMessage('Selecione um arquivo com extensão .csv.', 'error');
    return;
  }

  try {
    const parsed = parseCustomRulesCsv(await file.text());
    if (parsed.error) {
      setMessage(`Não foi possível importar o CSV. ${parsed.error}`, 'error');
      return;
    }
    rules = parsed.rules;
    renderRules();
    setMessage(`${rules.length} ${rules.length === 1 ? 'regra carregada' : 'regras carregadas'} no rascunho. Revise e salve para aplicar.`, 'success');
  } catch (error) {
    setMessage(`Não foi possível ler o arquivo CSV. Detalhe: ${(error && error.message) || error}`, 'error');
  }
});

$('btnSaveRules').addEventListener('click', async () => {
  const parsed = validateCustomRules(rules);
  if (parsed.error) {
    setMessage(parsed.error, 'error');
    const invalidIndex = Number(parsed.error.match(/Regra (\d+)/)?.[1]) - 1;
    $('rulesList').children[invalidIndex]?.querySelector('textarea')?.focus();
    return;
  }

  try {
    const settings = await loadSettings();
    await saveSettings({ ...settings, customRules: parsed.rules });
    rules = parsed.rules;
    savedRules = parsed.rules.map((rule) => ({ ...rule }));
    $('btnExportRules').disabled = savedRules.length === 0;
    renderRules();
    setMessage('Regras salvas. Elas serão usadas nas próximas análises.', 'success');
  } catch (error) {
    setMessage(`Não foi possível salvar as regras. Detalhe: ${(error && error.message) || error}`, 'error');
  }
});

$('btnClose').addEventListener('click', () => window.close());

(async function init() {
  try {
    const settings = await loadSettings();
    rules = settings.customRules;
    savedRules = settings.customRules.map((rule) => ({ ...rule }));
    $('btnExportRules').disabled = savedRules.length === 0;
  } catch (error) {
    rules = DEFAULT_SETTINGS.customRules;
    setMessage(`Não foi possível carregar as regras salvas. Detalhe: ${(error && error.message) || error}`, 'error');
  }
  renderRules();
})();
