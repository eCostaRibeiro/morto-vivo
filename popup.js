// Interface inicial: carrega/persiste opções e valida a lista antes de abrir results.html.
import { normalizeUrl } from './lib/normalize.js';
import { loadSettings, saveSettings, clearHistory, DEFAULT_SETTINGS } from './lib/history.js';
import { installButtonSoundFeedback } from './lib/audioFeedback.js';
import { containsDebuggerPermission, requestDebuggerPermission } from './lib/permissions.js';

const $ = (id) => document.getElementById(id);
let brands = '';

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
  brands = s.brands;
  $('tabMode').checked = s.tabMode;
  if (s.tabMode) {
    try {
      const granted = await containsDebuggerPermission();
      $('tabMode').checked = granted;
      if (!granted) {
        showStorageNotice(
          'A preferência do modo aba está salva, mas a permissão debugger não está concedida. '
          + 'Ative a opção novamente para solicitá-la.',
        );
      }
    } catch (err) {
      $('tabMode').checked = false;
      showStorageNotice(
        `Não foi possível verificar a permissão do modo aba. Ative a opção novamente `
        + `para tentar solicitá-la. Detalhe: ${(err && err.message) || err}`,
      );
    }
  }
  $('completionNotification').checked = s.completionNotification;
})();

async function persist() {
  try {
    await saveSettings({
      tabMode: $('tabMode').checked,
      completionNotification: $('completionNotification').checked,
      brands,
    });
    clearStorageNotice();
    return true;
  } catch (err) {
    showStorageNotice(`Não foi possível salvar as configurações. Verifique o armazenamento da extensão e tente novamente. Detalhe: ${(err && err.message) || err}`);
    return false;
  }
}
$('tabMode').addEventListener('change', async (event) => {
  const checkbox = event.currentTarget;
  if (!checkbox.checked) {
    await persist();
    return;
  }
  try {
    const granted = await requestDebuggerPermission();
    if (!granted) {
      checkbox.checked = false;
      showStorageNotice(
        'Permissão para o modo aba não concedida. As verificações HTTP continuam disponíveis.',
      );
      return;
    }
    if (!(await persist())) checkbox.checked = false;
  } catch (err) {
    checkbox.checked = false;
    showStorageNotice(
      `Não foi possível ativar o modo aba. Detalhe: ${(err && err.message) || err}`,
    );
  }
});
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

const MAX_URLS_POR_LOTE = 200; // acima disso, muitas abas/requisicoes simultaneas deixam o navegador pesado

$('btnVerificar').addEventListener('click', async () => {
  if (!(await persist())) return;
  const lines = $('listaUrls').value.split('\n').map((l) => l.trim()).filter(Boolean);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;
  // Deduplica depois da normalização para cobrir variações de esquema e formatação.
  for (const line of lines) {
    const n = normalizeUrl(line);
    if (!n) invalid.push(line);
    else if (!seen.has(n)) { seen.add(n); valid.push(n); }
    else duplicates++;
  }

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
  if (!valid.length) {
    if (!invalid.length) out.textContent = 'Por favor, insira pelo menos uma URL.';
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
    out.appendChild(box);
  }

  window.open(`results.html?urls=${encodeURIComponent(JSON.stringify(toCheck))}`, '_blank');
});
