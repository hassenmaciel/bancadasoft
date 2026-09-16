import { afterEach, describe, expect, it, vi } from "vitest";
import { createOrderPoller, ORDER_POLL_INTERVAL_MS, shouldPollOrder } from "./order-polling";
import type { OrderDTO } from "./dto";

const order = (orderStatus: string, paymentStatus: string): OrderDTO => ({
  id: "order-1", publicToken: "token", status: orderStatus as OrderDTO["status"], totalCents: 2900, createdAt: new Date(), items: [],
  payment: { status: paymentStatus as NonNullable<OrderDTO["payment"]>["status"], amountCents: 2900, externalPaymentId: "pay-1", pixPayload: "pix", qrCodeImage: null, expirationDate: new Date() },
  fulfillment: null, events: [],
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
    vi.useFakeTimers(); const interval = vi.spyOn(globalThis, "setInterval"); const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder: async () => order("PENDING_PAYMENT", "PENDING"), onUpdate: vi.fn() });
    poller.start(); poller.start(); expect(interval).toHaveBeenCalledOnce(); poller.stop();
  });
  it("cleanup interrompe consultas futuras", async () => {
    vi.useFakeTimers(); const fetchOrder = vi.fn(async () => order("PENDING_PAYMENT", "PENDING")); const poller = createOrderPoller({ initialOrder: order("PENDING_PAYMENT", "PENDING"), fetchOrder, onUpdate: vi.fn() });
    poller.start(); poller.stop(); await vi.advanceTimersByTimeAsync(ORDER_POLL_INTERVAL_MS * 2); expect(fetchOrder).not.toHaveBeenCalled();
  });
});
