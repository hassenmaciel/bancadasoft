import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOrderPoller,
  ORDER_POLL_FAST_PHASE_MS,
  ORDER_POLL_INTERVAL_MS,
  ORDER_POLL_SLOW_INTERVAL_MS,
  isFailedCheckoutOrder,
  isRecoverableCheckoutOrder,
  shouldContinueGuestDeliveryPolling,
  shouldPollOrder,
} from "./order-polling";
import type { OrderDTO } from "./dto";

const order = (orderStatus: string, paymentStatus: string): OrderDTO => ({
  id: "order-1", publicToken: "token", status: orderStatus as OrderDTO["status"], totalCents: 2900, createdAt: new Date(), items: [],
  payment: { status: paymentStatus as NonNullable<OrderDTO["payment"]>["status"], amountCents: 2900, externalPaymentId: "pay-1", pixPayload: "pix", qrCodeImage: null, expirationDate: new Date(), serverTime: new Date().toISOString() },
  fulfillment: null, events: [],
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("PIX expirado no acompanhamento", () => {
  it("Order PENDING_PAYMENT com Payment EXPIRED continua consultada e recuperável (permite novo PIX / pagamento tardio)", () => {
    expect(shouldPollOrder(order("PENDING_PAYMENT", "EXPIRED"))).toBe(true);
    expect(isRecoverableCheckoutOrder(order("PENDING_PAYMENT", "EXPIRED"))).toBe(true);
    expect(isFailedCheckoutOrder(order("PENDING_PAYMENT", "EXPIRED"))).toBe(false);
  });
});

describe("polling do pedido", () => {
  it("inicia consulta periódica para pagamento PENDING", async () => {
    vi.useFakeTimers(); const fetchOrder = vi.fn(async () => order("PENDING_PAYMENT", "PENDING"));
    const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate: vi.fn() }); poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS); expect(fetchOrder).toHaveBeenCalledOnce(); poller.stop();
  });
  it("atualiza PAID e continua até receber o estado final DELIVERED", async () => {
    vi.useFakeTimers(); const paid = order("PAID", "PAID"); const delivered = order("DELIVERED", "PAID"); const onUpdate = vi.fn(); const fetchOrder = vi.fn().mockResolvedValueOnce(paid).mockResolvedValueOnce(delivered);
    const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate }); poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 3); expect(onUpdate).toHaveBeenNthCalledWith(1, paid); expect(onUpdate).toHaveBeenNthCalledWith(2, delivered); expect(fetchOrder).toHaveBeenCalledTimes(2);
  });
  it("atualiza e encerra quando o pedido chega a DELIVERED", async () => {
    vi.useFakeTimers(); const delivered = order("DELIVERED", "PAID"); const onUpdate = vi.fn();
    const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder: async () => delivered, onUpdate }); poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS); expect(onUpdate).toHaveBeenCalledWith(delivered); expect(shouldPollOrder(delivered)).toBe(false);
  });
  it("start é idempotente e não cria timers duplicados", () => {
    vi.useFakeTimers(); const timeout = vi.spyOn(globalThis, "setTimeout"); const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder: async () => order("PENDING_PAYMENT", "PENDING"), onUpdate: vi.fn() });
    poller.start(); poller.start(); expect(timeout).toHaveBeenCalledOnce(); poller.stop();
  });
  it("cleanup interrompe consultas futuras", async () => {
    vi.useFakeTimers(); const fetchOrder = vi.fn(async () => order("PENDING_PAYMENT", "PENDING")); const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate: vi.fn() });
    poller.start(); poller.stop(); await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 2); expect(fetchOrder).not.toHaveBeenCalled();
  });
  it("[teste 9] não fica preso indefinidamente em PAID: reduz a frequência após o limite configurado, mas NUNCA para de consultar sozinho nem marca pagamento como falho", async () => {
    vi.useFakeTimers();
    const stuckPaid = order("PAID", "PAID");
    const fetchOrder = vi.fn(async () => stuckPaid);
    const onUpdate = vi.fn();
    const onSlowPhase = vi.fn();
    const poller = createOrderPoller({ initialOrder: stuckPaid, fetchOrder, onUpdate, onSlowPhase });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_FAST_PHASE_MS + ORDER_POLL_INTERVAL_MS);
    expect(onSlowPhase).toHaveBeenCalledOnce();
    const callsAtPhaseSwitch = fetchOrder.mock.calls.length;
    // fase de espera: continua consultando, só que a cada ORDER_POLL_SLOW_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(ORDER_POLL_SLOW_INTERVAL_MS * 3);
    expect(fetchOrder.mock.calls.length).toBeGreaterThan(callsAtPhaseSwitch);
    expect(onUpdate.mock.calls.every(([updated]) => updated.payment.status === "PAID")).toBe(true);
    poller.stop();
  });
  it("onSlowPhase dispara uma única vez mesmo com vários ciclos na fase de espera", async () => {
    vi.useFakeTimers();
    const stuckPaid = order("PAID", "PAID");
    const fetchOrder = vi.fn(async () => stuckPaid);
    const onSlowPhase = vi.fn();
    const poller = createOrderPoller({ initialOrder: stuckPaid, fetchOrder, onUpdate: vi.fn(), onSlowPhase });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_FAST_PHASE_MS + ORDER_POLL_SLOW_INTERVAL_MS * 5);
    expect(onSlowPhase).toHaveBeenCalledOnce();
    poller.stop();
  });
  it.each([
    ["FAILED", "FAILED", "PENDING_PAYMENT"],
    ["CANCELLED", "EXPIRED", "PENDING_PAYMENT"],
  ])("encerra o polling quando o pedido chega a %s", async (status, paymentStatus, initialStatus) => {
    vi.useFakeTimers();
    const terminal = order(status, paymentStatus);
    const fetchOrder = vi.fn(async () => terminal);
    const onUpdate = vi.fn();
    const poller = createOrderPoller({ initialOrder: order(initialStatus, "PENDING"), fetchOrder, onUpdate });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS);
    expect(onUpdate).toHaveBeenCalledWith(terminal);
    const callsAtTerminal = fetchOrder.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 5);
    expect(fetchOrder.mock.calls.length).toBe(callsAtTerminal);
  });
  it.each(["EXPIRED", "FAILED", "REFUNDED"])(
    "encerra o polling quando o pagamento chega a %s mesmo com Order ainda PAID/PROCESSING",
    async (paymentStatus) => {
      vi.useFakeTimers();
      const deadPayment = order("PROCESSING", paymentStatus);
      const fetchOrder = vi.fn(async () => deadPayment);
      const poller = createOrderPoller({ initialOrder: order("PAID", "PAID"), fetchOrder, onUpdate: vi.fn() });
      poller.start();
      await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS);
      const callsAtTerminal = fetchOrder.mock.calls.length;
      await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 5);
      expect(fetchOrder.mock.calls.length).toBe(callsAtTerminal);
    },
  );
  it("na fase de espera continua até um estado realmente terminal chegar", async () => {
    vi.useFakeTimers();
    const paid = order("PAID", "PAID");
    const delivered = order("DELIVERED", "PAID");
    let calls = 0;
    const fetchOrder = vi.fn(async () => {
      calls += 1;
      return calls <= 2 ? paid : delivered;
    });
    const onUpdate = vi.fn();
    const poller = createOrderPoller({ initialOrder: paid, fetchOrder, onUpdate });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_FAST_PHASE_MS + ORDER_POLL_SLOW_INTERVAL_MS * 2);
    expect(onUpdate.mock.calls.at(-1)?.[0]).toEqual(delivered);
  });
  it("nunca dispara POST: fetchOrder é a única função chamada pelo poller", async () => {
    vi.useFakeTimers();
    const fetchOrder = vi.fn(async () => order("PAID", "PAID"));
    const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate: vi.fn() });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 3);
    // O poller só conhece fetchOrder (GET); nenhuma outra função de escrita é injetada ou chamada.
    expect(fetchOrder.mock.calls.every((args) => args.length === 0)).toBe(true);
    poller.stop();
  });

  it("[INCIDENTE REAL 17/09/2026] FAILED + Payment PAID NÃO encerra o polling — continua até o backend convergir para DELIVERED sozinho", async () => {
    // Reproduz exatamente o que aconteceu nos dois pedidos reais: Order vira
    // FAILED poucos segundos depois de PAID (clean failure), mas o pagamento
    // permanece PAID. Antes da correção, o poller parava aqui para sempre e
    // só um GET manual a /acompanhar "acordava" a recuperação.
    vi.useFakeTimers();
    const failedPaid = order("FAILED", "PAID");
    const delivered = order("DELIVERED", "PAID");
    let calls = 0;
    const fetchOrder = vi.fn(async () => {
      calls += 1;
      return calls <= 3 ? failedPaid : delivered;
    });
    const onUpdate = vi.fn();
    const poller = createOrderPoller({ initialOrder: order("PAID", "PAID"), fetchOrder, onUpdate });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 4);
    expect(calls).toBeGreaterThanOrEqual(4); // não parou nas 3 primeiras respostas FAILED+PAID
    expect(onUpdate.mock.calls.at(-1)?.[0]).toEqual(delivered);
    poller.stop();
  });

  it("FAILED + payment NÃO PAID continua terminal (comportamento preservado)", async () => {
    vi.useFakeTimers();
    const terminal = order("FAILED", "FAILED");
    const fetchOrder = vi.fn(async () => terminal);
    const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate: vi.fn() });
    poller.start();
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS);
    const callsAtTerminal = fetchOrder.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 5);
    expect(fetchOrder.mock.calls.length).toBe(callsAtTerminal);
  });
});

describe("isRecoverableCheckoutOrder", () => {
  it("considera DELIVERED recuperável mesmo não estando mais ativo para polling", () => {
    const delivered = order("DELIVERED", "PAID");
    expect(shouldPollOrder(delivered)).toBe(false);
    expect(isRecoverableCheckoutOrder(delivered)).toBe(true);
  });
  it("não considera FAILED sem pagamento confirmado, ou CANCELLED, recuperáveis", () => {
    expect(isRecoverableCheckoutOrder(order("FAILED", "FAILED"))).toBe(false);
    expect(isRecoverableCheckoutOrder(order("CANCELLED", "EXPIRED"))).toBe(false);
  });
  it("[INCIDENTE REAL] considera FAILED + Payment PAID recuperável — backend ainda pode convergir", () => {
    expect(isRecoverableCheckoutOrder(order("FAILED", "PAID"))).toBe(true);
  });
  it("considera pedidos ainda ativos recuperáveis", () => {
    expect(isRecoverableCheckoutOrder(order("PENDING_PAYMENT", "PENDING"))).toBe(true);
    expect(isRecoverableCheckoutOrder(order("PAID", "PAID"))).toBe(true);
    expect(isRecoverableCheckoutOrder(order("PROCESSING", "PAID"))).toBe(true);
  });
});

describe("isFailedCheckoutOrder", () => {
  it("considera FAILED sem pagamento confirmado, e CANCELLED, como falha", () => {
    expect(isFailedCheckoutOrder(order("FAILED", "FAILED"))).toBe(true);
    expect(isFailedCheckoutOrder(order("CANCELLED", "EXPIRED"))).toBe(true);
  });
  it("[INCIDENTE REAL] NÃO considera FAILED + Payment PAID como falha definitiva", () => {
    expect(isFailedCheckoutOrder(order("FAILED", "PAID"))).toBe(false);
  });
  it.each(["EXPIRED", "FAILED", "REFUNDED"])(
    "considera falha quando o pagamento chega a %s mesmo com Order ainda PROCESSING",
    (paymentStatus) => {
      expect(isFailedCheckoutOrder(order("PROCESSING", paymentStatus))).toBe(true);
    },
  );
  it.each(["FAILED", "REFUNDED"])(
    "considera falha quando o pagamento chega a %s com Order PENDING_PAYMENT (só EXPIRED permite novo PIX)",
    (paymentStatus) => {
      expect(isFailedCheckoutOrder(order("PENDING_PAYMENT", paymentStatus))).toBe(true);
    },
  );
  it("NÃO considera DELIVERED como falha", () => {
    expect(isFailedCheckoutOrder(order("DELIVERED", "PAID"))).toBe(false);
  });
  it("NÃO considera pedidos ainda ativos (PIX pendente/liberando) como falha", () => {
    expect(isFailedCheckoutOrder(order("PENDING_PAYMENT", "PENDING"))).toBe(false);
    expect(isFailedCheckoutOrder(order("PAID", "PAID"))).toBe(false);
    expect(isFailedCheckoutOrder(order("PROCESSING", "PAID"))).toBe(false);
  });
});

describe("shouldContinueGuestDeliveryPolling (/acompanhar, backup por e-mail)", () => {
  it("para quando já existe Delivery", () => {
    expect(shouldContinueGuestDeliveryPolling("DELIVERED", "PAID", true)).toBe(false);
  });
  it("para em CANCELLED", () => {
    expect(shouldContinueGuestDeliveryPolling("CANCELLED", "EXPIRED", false)).toBe(false);
  });
  it("para em FAILED sem pagamento confirmado", () => {
    expect(shouldContinueGuestDeliveryPolling("FAILED", "FAILED", false)).toBe(false);
    expect(shouldContinueGuestDeliveryPolling("FAILED", null, false)).toBe(false);
  });
  it("[INCIDENTE REAL] continua em FAILED + Payment PAID — é essa consulta que aciona o recovery automático", () => {
    expect(shouldContinueGuestDeliveryPolling("FAILED", "PAID", false)).toBe(true);
  });
  it("continua em PENDING_PAYMENT/PAID/PROCESSING", () => {
    expect(shouldContinueGuestDeliveryPolling("PENDING_PAYMENT", "PENDING", false)).toBe(true);
    expect(shouldContinueGuestDeliveryPolling("PAID", "PAID", false)).toBe(true);
    expect(shouldContinueGuestDeliveryPolling("PROCESSING", "PAID", false)).toBe(true);
  });
});
