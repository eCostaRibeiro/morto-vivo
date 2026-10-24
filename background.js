chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'mv.createNotification') return;

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

  return true;
});
