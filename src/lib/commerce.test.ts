import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedPaymentWebhook } from "./payments/types";

const db = vi.hoisted(() => ({
  payment: { findFirst: vi.fn(), update: vi.fn() },
  paymentEvent: { findUnique: vi.fn(), create: vi.fn() },
  order: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const engine = vi.hoisted(() => {
  class FakeFulfillmentEngineError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "FulfillmentEngineError";
    }
  }
  return { executeFulfillment: vi.fn(), FakeFulfillmentEngineError };
});
vi.mock("@/lib/fulfillment-engine", () => ({
  executeFulfillment: engine.executeFulfillment,
  FulfillmentEngineError: engine.FakeFulfillmentEngineError,
}));
const { FakeFulfillmentEngineError } = engine;

import { processPayment } from "./commerce";

const paidEvent: ParsedPaymentWebhook = {
  provider: "asaas",
  providerEventId: "evt-paid-1",
  externalPaymentId: "pay-1",
  status: "PAID" as never,
  payload: { event: "PAYMENT_RECEIVED" },
};

const pendingPayment = {
  id: "payment-1",
  orderId: "order-1",
  status: "PENDING",
  externalPaymentId: null,
};

describe("processPayment — falha de fulfillment não pode ficar silenciosa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.payment.findFirst.mockResolvedValue(pendingPayment);
    db.paymentEvent.findUnique.mockResolvedValue(null);
    db.$transaction.mockImplementation(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : ops,
    );
    db.order.findUnique.mockResolvedValue({
      id: "order-1",
      status: "PAID",
      payment: { status: "PAID" },
    });
  });

  it("[teste 1] registra (não engole) a exceção de executeFulfillment via callback log injetado", async () => {
    engine.executeFulfillment.mockRejectedValue(
      new FakeFulfillmentEngineError("PROVIDER_NOT_CONNECTED"),
    );
    const log = vi.fn();
    await processPayment(paidEvent, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("fulfillment"),
      expect.objectContaining({ orderId: "order-1", code: "PROVIDER_NOT_CONNECTED" }),
    );
  });

  it("[teste 3] o log da falha nunca contém token/segredo/payload sensível — apenas orderId + código sanitizado", async () => {
    engine.executeFulfillment.mockRejectedValue(
      new Error("fetch failed: Authorization Bearer sk_super_secret_token_123"),
    );
    const log = vi.fn();
    await processPayment(paidEvent, log);
    const [, context] = log.mock.calls[0];
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("sk_super_secret_token_123");
    expect(serialized).not.toContain("Bearer");
    expect(context).toEqual({
      orderId: "order-1",
      name: "Error",
      code: "FULFILLMENT_INTERNAL_ERROR",
    });
  });

  it("[teste 10] Payment permanece PAID (não é revertido) mesmo quando o fulfillment falha", async () => {
    engine.executeFulfillment.mockRejectedValue(
      new FakeFulfillmentEngineError("PROVIDER_NOT_CONNECTED"),
    );
    await processPayment(paidEvent, vi.fn());
    // A transação que grava Payment=PAID já foi commitada antes de chamar
    // executeFulfillment; nenhuma chamada adicional a payment.update ocorre
    // no catch — o estado financeiro não é tocado pela falha de fulfillment.
    expect(db.payment.update).toHaveBeenCalledTimes(1);
    expect(db.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
    );
  });

  it("não loga nada quando o fulfillment é executado com sucesso", async () => {
    engine.executeFulfillment.mockResolvedValue({ status: "COMPLETED" });
    const log = vi.fn();
    await processPayment(paidEvent, log);
    expect(log).not.toHaveBeenCalled();
  });
});
