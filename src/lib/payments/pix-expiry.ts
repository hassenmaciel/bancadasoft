// Única fonte da validade do PIX: para mudar o prazo, altere só esta constante.
export const PIX_VALIDITY_MS = 30 * 60 * 1000;
// Janela final em que o contador é destacado como alerta.
export const PIX_ALERT_MS = 5 * 60 * 1000;

export const pixExpiresAt = (from: Date = new Date()) =>
  new Date(from.getTime() + PIX_VALIDITY_MS);

export const isPixExpired = (expiresAt: Date | string, now: number = Date.now()) =>
  new Date(expiresAt).getTime() <= now;

// Tempo restante usando o relógio do SERVIDOR como referência: serverTime é o
// instante do servidor quando a resposta foi montada e receivedAtMs é o
// Date.now() do cliente ao recebê-la. Só o intervalo decorrido no cliente é
// somado, então um relógio do cliente adiantado/atrasado não altera o prazo.
export function pixRemainingMs(
  expirationDate: Date | string,
  serverTime: Date | string,
  receivedAtMs: number,
  nowMs: number = Date.now(),
) {
  const serverNow = new Date(serverTime).getTime() + Math.max(0, nowMs - receivedAtMs);
  return Math.max(0, new Date(expirationDate).getTime() - serverNow);
}

export function formatPixCountdown(remainingMs: number) {
  const total = Math.ceil(Math.max(0, remainingMs) / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
