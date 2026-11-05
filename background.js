chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
