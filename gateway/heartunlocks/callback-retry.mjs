// Reenvio em memória dos avisos da HeartUnlocks quando o app falha.
// Atenção: os pendentes vivem só neste processo; um restart do serviço os perde.

// Intervalo antes de cada nova tentativa: 1, 2, 4 e 8 minutos (5 tentativas no total).
export const CALLBACK_RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000];
export const MAX_PENDING_CALLBACKS = 500;

// Só o tipo do erro, nunca o conteúdo do aviso nem segredos.
const failureCode = (error) => {
  if (error instanceof Error && /^APP_CALLBACK_HTTP_\d+$/.test(error.message)) return error.message;
  return [error instanceof Error ? error.name : "UNKNOWN", error?.cause?.code].filter(Boolean).join(":");
};

export function createCallbackRetrier({ forward, delaysMs = CALLBACK_RETRY_DELAYS_MS, maxPending = MAX_PENDING_CALLBACKS, logger = console }) {
  const maxAttempts = delaysMs.length + 1;
  // referenceId -> { payload, attempt }. Um aviso por reference_id: o mais recente substitui o anterior.
  const pending = new Map();

  const finish = (referenceId, attempt, result) => {
    pending.delete(referenceId);
    if (result === "ok") return;
    logger.error("callback retry exhausted", { referenceId, attempts: attempt, result });
  };

  const schedule = (referenceId) => {
    const entry = pending.get(referenceId);
    const timer = setTimeout(() => void retry(referenceId), delaysMs[entry.attempt - 1]);
    timer.unref?.();
  };

  async function retry(referenceId) {
    const entry = pending.get(referenceId);
    if (!entry) return;
    entry.attempt += 1;
    const sent = entry.payload;
    let result = "ok";
    try { await forward(sent); }
    catch (error) { result = failureCode(error); }
    // Chegou aviso mais novo durante o envio: ele ainda precisa ser entregue.
    if (result === "ok" && entry.payload !== sent) result = "SUPERSEDED";
    logger.info("callback retry attempt", { referenceId, attempt: entry.attempt, maxAttempts, result });
    if (result === "ok" || entry.attempt >= maxAttempts) return finish(referenceId, entry.attempt, result);
    schedule(referenceId);
  }

  // Resolve { delivered: true } se o app aceitou agora; senão o aviso fica (ou já estava) na fila.
  async function deliver(payload) {
    const referenceId = payload.reference_id;
    const existing = pending.get(referenceId);
    if (existing) {
      existing.payload = payload;
      logger.warn("callback duplicate while retry pending", { referenceId, attempt: existing.attempt });
      return { delivered: false, queued: true, duplicate: true };
    }
    try {
      await forward(payload);
      return { delivered: true };
    } catch (error) {
      logger.warn("callback forward attempt", { referenceId, attempt: 1, maxAttempts, result: failureCode(error) });
      const raced = pending.get(referenceId);
      if (raced) { raced.payload = payload; return { delivered: false, queued: true, duplicate: true }; }
      if (pending.size >= maxPending) {
        logger.error("CRITICAL callback retry queue full, notice dropped", { referenceId, pending: pending.size, limit: maxPending });
        return { delivered: false, queued: false };
      }
      pending.set(referenceId, { payload, attempt: 1 });
      schedule(referenceId);
      return { delivered: false, queued: true };
    }
  }

  return { deliver, pendingCount: () => pending.size };
}
