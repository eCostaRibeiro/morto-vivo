const STATUS_LABEL = { vivo: 'Vivo', zumbi: 'Zumbi', morto: 'Morto', indeterminado: 'Indeterminado' };
const VALID_STATUSES = new Set(Object.keys(STATUS_LABEL));

export function applyManualClassification(result, status) {
  if (!VALID_STATUSES.has(status)) throw new TypeError(`Status manual inválido: ${status}`);
  if (!result.manualClassification) {
    result.automaticStatus = result.status;
    result.automaticReason = result.reason;
  }
  result.manualClassification = status;
  result.status = status;
  result.reason = `Classificação manual: ${STATUS_LABEL[status]}`;
  result.tags = [...new Set([...(result.tags || []).filter((tag) => tag !== 'manual'), 'manual'])];
  return result;
}

export function clearManualClassification(result) {
  if (!result.manualClassification) return result;
  result.status = result.automaticStatus;
  result.reason = result.automaticReason;
  delete result.automaticStatus;
  delete result.automaticReason;
  delete result.manualClassification;
  result.tags = (result.tags || []).filter((tag) => tag !== 'manual');
  return result;
}
