// Interface inicial: carrega/persiste opções e valida a lista antes de abrir results.html.
import { loadSettings, saveSettings, clearHistory, DEFAULT_SETTINGS } from './lib/history.js';
import { installButtonSoundFeedback } from './lib/audioFeedback.js';
import { MAX_IMPORTED_URLS, MAX_IMPORT_FILE_BYTES, parseUrlList } from './lib/urlList.js';
import { discardImportedBatch, saveImportedBatch } from './lib/importedBatch.js';

const $ = (id) => document.getElementById(id);

installButtonSoundFeedback();

function showStorageNotice(message) {
  const notice = $('storageNotice');
  notice.textContent = message;
  notice.hidden = false;
}

function clearStorageNotice() {
  const notice = $('storageNotice');
  notice.textContent = '';
  notice.hidden = true;
}

(async function init() {
  let s;
  try {
    s = await loadSettings();
  } catch (err) {
    s = { ...DEFAULT_SETTINGS };
    showStorageNotice(`Não foi possível carregar as configurações salvas; os padrões serão usados nesta sessão. Detalhe: ${(err && err.message) || err}`);
  }
  $('tabMode').checked = s.tabMode;
  $('completionNotification').checked = s.completionNotification;
})();

async function persist() {
  try {
    const currentSettings = await loadSettings();
    await saveSettings({
      ...currentSettings,
      tabMode: $('tabMode').checked,
      completionNotification: $('completionNotification').checked,
    });
    clearStorageNotice();
    return true;
  } catch (err) {
    showStorageNotice(`Não foi possível salvar as configurações. Verifique o armazenamento da extensão e tente novamente. Detalhe: ${(err && err.message) || err}`);
    return false;
  }
}
$('tabMode').addEventListener('change', persist);
$('btnManageRules').addEventListener('click', () => window.open('rules.html', '_blank'));
$('completionNotification').addEventListener('change', (event) => {
  const checkbox = event.currentTarget;
  if (!checkbox.checked) {
    persist();
    return;
  }
  if (!chrome.permissions?.request) {
    checkbox.checked = false;
    showStorageNotice('Este navegador não permite solicitar a permissão para notificações.');
    return;
  }
  chrome.permissions.request({ permissions: ['notifications'] }, async (granted) => {
    const permissionError = chrome.runtime.lastError;
    if (permissionError || !granted) {
      checkbox.checked = false;
      showStorageNotice(permissionError
        ? `Não foi possível solicitar permissão para notificações. Detalhe: ${permissionError.message}`
        : 'Permissão para notificações não concedida. O aviso na tela de resultados continuará disponível.');
      return;
    }
    if (!(await persist())) checkbox.checked = false;
    if (checkbox.checked) {
      chrome.runtime.sendMessage({
        type: 'mv.createNotification',
        title: 'Morto-Vivo',
        message: 'Notificações ativadas. Este é um aviso de teste.',
      }, (response) => {
        const messageError = chrome.runtime.lastError;
        if (messageError || !response?.ok) {
          showStorageNotice(`A opção foi salva, mas não foi possível enviar a notificação de teste: ${messageError?.message || response?.error || 'resposta inválida'}`);
          return;
        }
        clearStorageNotice();
      });
    }
  });
});

$('btnLimpar').addEventListener('click', async () => {
  try {
    await clearHistory();
    $('btnLimpar').textContent = 'Histórico limpo ✓';
    clearStorageNotice();
  } catch (err) {
    showStorageNotice(`Não foi possível limpar o histórico. Verifique o armazenamento da extensão e tente novamente. Detalhe: ${(err && err.message) || err}`);
  }
});

const MAX_URLS_POR_LOTE = 200;
const verifyButton = $('btnVerificar');
const verifyButtonAnchor = $('verifyButtonAnchor');
verifyButtonAnchor.after(verifyButton);

function placeVerifyButtonInPasteFlow() {
  verifyButtonAnchor.after(verifyButton);
  verifyButton.classList.remove('in-import');
  verifyButton.title = 'Valida, remove duplicatas e analisa até 200 URLs válidas';
}

function placeVerifyButtonInImportFlow() {
  $('importPreview').after(verifyButton);
  verifyButton.classList.add('in-import');
  verifyButton.title = 'Analisa as URLs válidas do arquivo TXT selecionado';
}

function updateUrlCounter() {
  const { valid } = parseUrlList($('listaUrls').value);
  const counter = $('urlCounter');
  const overLimit = valid.length > MAX_URLS_POR_LOTE;
  counter.classList.toggle('over-limit', overLimit);
  counter.textContent = overLimit
    ? `${valid.length}/${MAX_URLS_POR_LOTE} URLs válidas únicas — serão analisadas apenas as primeiras ${MAX_URLS_POR_LOTE}.`
    : `${valid.length}/${MAX_URLS_POR_LOTE} URLs válidas únicas`;
}

$('listaUrls').addEventListener('input', () => {
  updateUrlCounter();
  if (importedUrls.length) {
    importedUrls = [];
    $('importPreview').textContent = '';
    $('importSection').open = false;
    placeVerifyButtonInPasteFlow();
  }
});
updateUrlCounter();

function showInputSummary(valid, invalid, duplicates) {
  const out = $('resultados');
  out.innerHTML = '';
  const summary = document.createElement('p');
  summary.className = 'hint';
  summary.setAttribute('role', 'status');
  summary.textContent = `Entrada revisada: ${valid.length} URL${valid.length === 1 ? '' : 's'} única${valid.length === 1 ? '' : 's'} válida${valid.length === 1 ? '' : 's'}`
    + `${invalid.length ? `, ${invalid.length} inválida${invalid.length === 1 ? '' : 's'} ignorada${invalid.length === 1 ? '' : 's'}` : ''}`
    + `${duplicates ? ` e ${duplicates} duplicada${duplicates === 1 ? '' : 's'} removida${duplicates === 1 ? '' : 's'}` : ''}.`;
  out.appendChild(summary);
  if (invalid.length) {
    const box = document.createElement('div');
    box.className = 'error-box';
    box.setAttribute('role', 'alert');
    box.textContent = `URLs inválidas (ignoradas). São aceitos endereços HTTP(S) com hostname válido, sem usuário ou senha; esquemas como ftp:// não são aceitos.\n${invalid.join('\n')}`;
    out.appendChild(box);
  }
}

$('btnVerificar').addEventListener('click', async () => {
  if (!(await persist())) return;
  if (importedUrls.length) {
    try {
      const batchId = await saveImportedBatch(importedUrls);
      const resultsPage = window.open(`results.html?batch=${encodeURIComponent(batchId)}`, '_blank');
      if (!resultsPage) {
        await discardImportedBatch(batchId);
        showStorageNotice('O navegador bloqueou a nova aba. Permita pop-ups para iniciar a análise.');
      }
    } catch (error) {
      showStorageNotice(`Não foi possível preparar a lista importada. Detalhe: ${(error && error.message) || error}`);
    }
    return;
  }
  const { valid, invalid, duplicates } = parseUrlList($('listaUrls').value);
  showInputSummary(valid, invalid, duplicates);
  if (!valid.length) {
    if (!invalid.length) $('resultados').textContent = 'Por favor, insira pelo menos uma URL.';
    return;
  }

  let toCheck = valid;
  if (valid.length > MAX_URLS_POR_LOTE) {
    toCheck = valid.slice(0, MAX_URLS_POR_LOTE);
    const box = document.createElement('div');
    box.className = 'error-box';
    box.setAttribute('role', 'alert');
    box.textContent = `Lote limitado a ${MAX_URLS_POR_LOTE} URLs por vez (você colou ${valid.length}). `
      + `As ${valid.length - MAX_URLS_POR_LOTE} restantes foram ignoradas nesta execução — rode o restante em um novo lote.`;
    $('resultados').appendChild(box);
  }

  window.open(`results.html?urls=${encodeURIComponent(JSON.stringify(toCheck))}`, '_blank');
});

let importedUrls = [];
let importRevision = 0;
$('arquivoUrls').addEventListener('change', async (event) => {
  const fileInput = event.currentTarget;
  const file = fileInput.files?.[0];
  fileInput.value = '';
  $('importSection').open = true;
  const revision = ++importRevision;
  importedUrls = [];
  placeVerifyButtonInPasteFlow();
  $('importPreview').textContent = '';
  if (!file) return;
  if (!/\.txt$/i.test(file.name) || file.size > MAX_IMPORT_FILE_BYTES) {
    $('importPreview').textContent = `Selecione um arquivo .txt de até ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB.`;
    return;
  }
  try {
    const { valid, invalid, duplicates } = parseUrlList(await file.text());
    if (revision !== importRevision) return;
    if (valid.length > MAX_IMPORTED_URLS) {
      $('importPreview').textContent = `Arquivo contém ${valid.length} URLs válidas; o máximo por importação é ${MAX_IMPORTED_URLS}.`;
      return;
    }
    importedUrls = valid;
    $('importPreview').textContent = `${valid.length} URL${valid.length === 1 ? '' : 's'} válida${valid.length === 1 ? '' : 's'}`
      + `${invalid.length ? `, ${invalid.length} inválida${invalid.length === 1 ? '' : 's'}` : ''}`
      + `${duplicates ? ` e ${duplicates} duplicada${duplicates === 1 ? '' : 's'} removida${duplicates === 1 ? '' : 's'}` : ''}.`;
    if (invalid.length) $('importPreview').textContent += ' Endereços inválidos não serão analisados.';
    if (valid.length) placeVerifyButtonInImportFlow();
  } catch (error) {
    if (revision !== importRevision) return;
    $('importPreview').textContent = `Não foi possível ler o arquivo. Detalhe: ${(error && error.message) || error}`;
  }
});
