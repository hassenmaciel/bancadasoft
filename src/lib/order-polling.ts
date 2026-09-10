import type { OrderDTO } from "./dto";

export const ORDER_POLL_INTERVAL_MS = 3000;

const finalOrderStatuses = new Set(["DELIVERED", "FAILED", "CANCELLED"]);
const finalPaymentStatuses = new Set(["EXPIRED", "FAILED", "REFUNDED"]);

export function shouldPollOrder(order: OrderDTO) {
  if (finalOrderStatuses.has(order.status)) return false;
  return Boolean(order.payment && !finalPaymentStatuses.has(order.payment.status));
}

type PollerOptions = {
  initialOrder: OrderDTO;
  fetchOrder: () => Promise<OrderDTO>;
  onUpdate: (order: OrderDTO) => void;
  intervalMs?: number;
};

export function createOrderPoller({ initialOrder, fetchOrder, onUpdate, intervalMs = ORDER_POLL_INTERVAL_MS }: PollerOptions) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let requestInFlight = false;

  const stop = () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };

  const poll = async () => {
    if (stopped || requestInFlight) return;
    requestInFlight = true;
    try {
      const updated = await fetchOrder();
      if (stopped) return;
      onUpdate(updated);
      if (!shouldPollOrder(updated)) stop();
    } finally {
      requestInFlight = false;
    }
  };

  return {
    start() {
      if (timer || stopped || !shouldPollOrder(initialOrder)) return;
      timer = setInterval(poll, intervalMs);
    },
    stop,
  };
}
