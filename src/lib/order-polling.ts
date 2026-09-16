import type { OrderDTO } from "./dto";

// Fase rápida: primeiros minutos após o pagamento, quando o fulfillment
// automático normalmente conclui.
export const ORDER_POLL_INTERVAL_MS = 3000;
export const ORDER_POLL_FAST_PHASE_MS = 3 * 60 * 1000;
// Fase de espera: depois da fase rápida o polling NUNCA para definitivamente
// enquanto o pedido não chegar a um estado terminal — só reduz a frequência,
// para não deixar o cliente com PIX pago preso num "sumiço" da UI caso o
// fulfillment automático demore além do normal.
export const ORDER_POLL_SLOW_INTERVAL_MS = 20 * 1000;

export const TERMINAL_ORDER_STATUSES = new Set(["DELIVERED", "FAILED", "CANCELLED"]);
const finalPaymentStatuses = new Set(["EXPIRED", "FAILED", "REFUNDED"]);

export function shouldPollOrder(order: OrderDTO) {
  if (TERMINAL_ORDER_STATUSES.has(order.status)) return false;
  return Boolean(order.payment && !finalPaymentStatuses.has(order.payment.status));
}

// Grupo A (spec PARTE 1): PENDING_PAYMENT / PAID / PROCESSING podem auto-restaurar
// o checkout na página do produto. Grupo B (terminal, ou pagamento expirado/falho/
// reembolsado) não pode — mesma regra usada para decidir se o polling continua.
export const isActiveCheckoutOrder = (order: OrderDTO) => shouldPollOrder(order);

// DELIVERED não é "ativo" (não deve mais ser consultado pelo polling), mas
// continua sendo uma compra recuperável: reabrir a página/o modal deve
// mostrar a entrega já pronta em vez de descartar a referência e voltar ao
// formulário. FAILED/CANCELLED permanecem não recuperáveis.
export const isRecoverableCheckoutOrder = (order: OrderDTO) =>
  isActiveCheckoutOrder(order) || order.status === "DELIVERED";

// Terminal sem entrega: FAILED/CANCELLED, ou pagamento que morreu (EXPIRED/
// FAILED/REFUNDED) antes da Order chegar a DELIVERED. Continua terminal para
// o polling (nunca reativa sozinho) — usado pela UI só para nunca exibir
// mensagem de "liberando"/PIX pendente para um pedido que não vai progredir.
export const isFailedCheckoutOrder = (order: OrderDTO) =>
  !isRecoverableCheckoutOrder(order);

type PollerOptions = {
  initialOrder: OrderDTO;
  fetchOrder: () => Promise<OrderDTO>;
  onUpdate: (order: OrderDTO) => void;
  /** Disparado uma única vez ao cruzar para a fase de espera (frequência reduzida). */
  onSlowPhase?: () => void;
  fastIntervalMs?: number;
  slowIntervalMs?: number;
  fastPhaseDurationMs?: number;
};

export function createOrderPoller({
  initialOrder,
  fetchOrder,
  onUpdate,
  onSlowPhase,
  fastIntervalMs = ORDER_POLL_INTERVAL_MS,
  slowIntervalMs = ORDER_POLL_SLOW_INTERVAL_MS,
  fastPhaseDurationMs = ORDER_POLL_FAST_PHASE_MS,
}: PollerOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let requestInFlight = false;
  let startedAt = 0;
  let slowPhaseNotified = false;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const inSlowPhase = () => Date.now() - startedAt >= fastPhaseDurationMs;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(poll, inSlowPhase() ? slowIntervalMs : fastIntervalMs);
  };

  const poll = async () => {
    if (stopped) return;
    if (!slowPhaseNotified && inSlowPhase()) {
      slowPhaseNotified = true;
      onSlowPhase?.();
    }
    if (!requestInFlight) {
      requestInFlight = true;
      try {
        // Somente leitura: nunca cria Order/Payment, nunca chama provider.
        const updated = await fetchOrder();
        if (!stopped) {
          onUpdate(updated);
          if (!shouldPollOrder(updated)) {
            stop();
            return;
          }
        }
      } catch {
        // Rede instável: tenta novamente no próximo ciclo, sem interromper o polling.
      } finally {
        requestInFlight = false;
      }
    }
    scheduleNext();
  };

  return {
    start() {
      if (timer || stopped || !shouldPollOrder(initialOrder)) return;
      startedAt = Date.now();
      scheduleNext();
    },
    stop,
  };
}
