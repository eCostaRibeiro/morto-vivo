const TIKTOK_SESSION_KEY_PREFIX = 'mv_tiktok_session_owner_';

function isResultsPage(sender) {
  return sender.id === chrome.runtime.id
    && typeof sender.url === 'string'
    && sender.url.split('?')[0] === chrome.runtime.getURL('results.html');
}

async function updateTikTokSessionOwnership(message) {
  const { ownerWindowId, tiktokWindowId } = message;
  if (!Number.isInteger(ownerWindowId) || !Number.isInteger(tiktokWindowId)) {
    throw new Error('IDs de janela inválidos para a sessão TikTok.');
  }
  const key = `${TIKTOK_SESSION_KEY_PREFIX}${ownerWindowId}`;
  if (message.type === 'mv.registerTikTokWindow') {
    await chrome.windows.get(ownerWindowId);
    await chrome.storage.session.set({ [key]: tiktokWindowId });
    try {
      await chrome.windows.get(ownerWindowId);
    } catch (error) {
      try {
        await chrome.storage.session.remove(key);
      } catch (cleanupError) {
        console.error('Não foi possível limpar o registro da sessão TikTok sem janela de resultados:', cleanupError);
      }
      try {
        await chrome.windows.remove(tiktokWindowId);
      } catch (cleanupError) {
        if (!/no window with id/i.test(String((cleanupError && cleanupError.message) || cleanupError))) {
          console.error('Não foi possível fechar a janela TikTok sem janela de resultados:', cleanupError);
        }
      }
      throw new Error('A janela de resultados foi fechada antes do início da sessão TikTok.');
    }
  } else {
    await chrome.storage.session.remove(key);
  }
}

async function cleanTikTokSessionOwnership(removedWindowId) {
  const sessions = await chrome.storage.session.get(null);
  const removedKeys = [];
  const windowsToClose = [];
  for (const [key, tiktokWindowId] of Object.entries(sessions)) {
    if (!key.startsWith(TIKTOK_SESSION_KEY_PREFIX)) continue;
    const ownerWindowId = Number(key.slice(TIKTOK_SESSION_KEY_PREFIX.length));
    if (ownerWindowId === removedWindowId) {
      removedKeys.push(key);
      if (Number.isInteger(tiktokWindowId) && tiktokWindowId !== removedWindowId) {
        windowsToClose.push(tiktokWindowId);
      }
    } else if (tiktokWindowId === removedWindowId) {
      removedKeys.push(key);
    }
  }
  if (removedKeys.length) await chrome.storage.session.remove(removedKeys);
  await Promise.all(windowsToClose.map(async (windowId) => {
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      if (!/no window with id/i.test(String((error && error.message) || error))) throw error;
    }
  }));
}

chrome.windows.onRemoved.addListener((windowId) => {
  cleanTikTokSessionOwnership(windowId)
    .catch((error) => console.error('Não foi possível encerrar a janela TikTok vinculada:', error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isResultsPage(sender)
      && ['mv.registerTikTokWindow', 'mv.releaseTikTokWindow'].includes(message?.type)) {
    updateTikTokSessionOwnership(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: String((error && error.message) || error),
      }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || message?.type !== 'mv.createNotification') return;

  // A permissão é conferida no momento do uso, não apenas quando a opção foi ativada.
  chrome.permissions.contains({ permissions: ['notifications'] }, (granted) => {
    const permissionError = chrome.runtime.lastError;
    if (permissionError) {
      sendResponse({ ok: false, error: permissionError.message });
      return;
    }
    if (!granted) {
      sendResponse({ ok: false, error: 'Permissão de notificações não concedida.' });
      return;
    }
    if (!chrome.notifications?.create) {
      sendResponse({ ok: false, error: 'A API de notificações não está disponível neste navegador.' });
      return;
    }

    const notificationId = `mv-${Date.now()}`;
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/zombie-128.png'),
      title: String(message.title || 'Morto-Vivo').slice(0, 80),
      message: String(message.message || '').slice(0, 240),
      silent: false,
    }, () => {
      const notificationError = chrome.runtime.lastError;
      sendResponse(notificationError
        ? { ok: false, error: notificationError.message }
        : { ok: true });
    });
  });

  // Mantém o canal aberto até a resposta assíncrona de notifications.create.
  return true;
});

const SETTINGS_KEY = 'mv_settings';

function isWebTab(tab) {
  return tab?.id !== undefined && /^https?:\/\//i.test(tab.url || '');
}

async function markerEnabled() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return !!stored[SETTINGS_KEY]?.markCheckedUrls;
}

async function setTabMarker(tab, enabled) {
  if (!isWebTab(tab)) return;
  const target = { tabId: tab.id };
  try {
    if (enabled) {
      await chrome.scripting.insertCSS({ target, files: ['pageMarker.css'] });
      await chrome.scripting.executeScript({ target, files: ['pageMarker.js'] });
    } else {
      await chrome.scripting.removeCSS({ target, files: ['pageMarker.css'] });
    }
  } catch (error) {
    console.error(`Não foi possível atualizar a marcação de URLs na aba ${tab.id}:`, error);
  }
}

async function updateOpenTabMarkers(enabled) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => setTabMarker(tab, enabled)));
}

function syncOpenTabMarkers() {
  markerEnabled()
    .then((enabled) => enabled && updateOpenTabMarkers(true))
    .catch((error) => console.error('Não foi possível carregar a opção de marcação de URLs:', error));
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isWebTab(tab)) return;
  markerEnabled()
    .then((enabled) => enabled && setTabMarker(tab, true))
    .catch((error) => console.error('Não foi possível carregar a opção de marcação de URLs:', error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
  const oldValue = !!changes[SETTINGS_KEY].oldValue?.markCheckedUrls;
  const newValue = !!changes[SETTINGS_KEY].newValue?.markCheckedUrls;
  if (oldValue !== newValue) {
    updateOpenTabMarkers(newValue)
      .catch((error) => console.error('Não foi possível atualizar a marcação nas abas abertas:', error));
  }
});

chrome.runtime.onStartup.addListener(syncOpenTabMarkers);
syncOpenTabMarkers();
