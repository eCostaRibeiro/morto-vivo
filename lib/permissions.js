function requestPermissionApi(method) {
  return new Promise((resolve, reject) => {
    const api = chrome.permissions?.[method];
    if (!api) {
      reject(new Error('Este navegador não permite gerenciar permissões opcionais.'));
      return;
    }
    api.call(chrome.permissions, { permissions: ['debugger'] }, (granted) => {
      const permissionError = chrome.runtime.lastError;
      if (permissionError) reject(new Error(permissionError.message));
      else resolve(granted);
    });
  });
}

export function containsDebuggerPermission() {
  return requestPermissionApi('contains');
}

export function requestDebuggerPermission() {
  return requestPermissionApi('request');
}
