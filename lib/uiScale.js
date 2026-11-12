import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from './history.js';

const CONTENT_SIZES = {
  compact: { scale: '0.9', label: 'compacto' },
  normal: { scale: '1', label: 'padrão' },
  large: { scale: '1.15', label: 'amplo' },
};

function normalizeContentSize(value) {
  return Object.hasOwn(CONTENT_SIZES, value) ? value : DEFAULT_SETTINGS.contentSize;
}

export function installUiScaleControl() {
  const control = document.querySelector('[data-ui-scale-control]');
  if (!control) return;

  const buttons = [...control.querySelectorAll('[data-ui-scale]')];
  const message = control.querySelector('.ui-scale-message');
  let currentSize = DEFAULT_SETTINGS.contentSize;
  let saving = true;

  function render(size) {
    currentSize = normalizeContentSize(size);
    document.documentElement.style.setProperty('--ui-scale', CONTENT_SIZES[currentSize].scale);
    buttons.forEach((button) => {
      const selected = button.dataset.uiScale === currentSize;
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = saving;
    });
    control.querySelector('.ui-scale-label').textContent = `Tamanho ${CONTENT_SIZES[currentSize].label}`;
  }

  function showError(action, error) {
    message.textContent = `Não foi possível ${action} o tamanho da interface. Detalhe: ${(error && error.message) || error}`;
    message.hidden = false;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const nextSize = normalizeContentSize(button.dataset.uiScale);
      if (saving || nextSize === currentSize) return;
      const previousSize = currentSize;
      saving = true;
      render(nextSize);
      try {
        const settings = await loadSettings();
        await saveSettings({ ...settings, contentSize: nextSize });
        message.hidden = true;
      } catch (error) {
        render(previousSize);
        showError('salvar', error);
      } finally {
        saving = false;
        render(currentSize);
      }
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
    render(changes[SETTINGS_KEY].newValue?.contentSize);
  });

  loadSettings()
    .then((settings) => render(settings.contentSize))
    .catch((error) => showError('carregar', error))
    .finally(() => {
      saving = false;
      render(currentSize);
    });
}
