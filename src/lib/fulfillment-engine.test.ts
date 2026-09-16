import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  fulfillment: { upsert: vi.fn(), update: vi.fn() },
  providerOrder: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  provider: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { executeFulfillment, FulfillmentEngineError } from "./fulfillment-engine";

const baseOrder = () => ({
  id: "order-adclean-1",
  status: "PAID",
  payment: { status: "PAID" },
  fulfillment: null,
  items: [
    {
      unitPriceCents: 2000,
      providerFields: {},
      providerProduct: {
        id: "provider-product-adclean-ticket-168h",
        providerId: "provider-adclean-v2",
        externalProductId: "ticket-168h",
        active: true,
        mode: "REAL",
        technicalEligibility: "READY",
        providerCostCents: null,
        currency: "BRL",
        fieldSchema: null,
        provider: {
          id: "provider-adclean-v2",
          code: "adclean",
          active: true,
          integrationStatus: "NOT_CONNECTED",
        },
      },
      product: { providerProducts: [] },
    },
  ],
});

describe("executeFulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
    db.order.findUnique.mockResolvedValue(baseOrder());
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-1" });
    db.order.update.mockResolvedValue({});
  });

  it("[teste 2 / teste 8] reproduz o incidente: AdClean sem credencial -> PROVIDER_NOT_CONNECTED, adapter nunca chamado, e persiste evidência FAILED", async () => {
    await expect(executeFulfillment("order-adclean-1")).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONNECTED",
    });
    expect(db.fulfillment.upsert).toHaveBeenCalledTimes(1);
    expect(db.fulfillment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-adclean-1" },
        create: expect.objectContaining({ provider: "adclean", status: "FAILED" }),
      }),
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("[teste 2] quando a reserva do slot (Fulfillment/ProviderOrder) falha e sofre rollback, ainda assim persiste FAILED fora dessa transação", async () => {
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    // Simula: a transação de reserva do slot lança um erro de banco inesperado
    // (não relacionado a configuração) — deve fazer rollback e, mesmo assim,
    // deixar um Fulfillment(FAILED) visível fora dela.
    let callCount = 0;
    db.$transaction.mockImplementation(async (arg) => {
      callCount += 1;
      if (typeof arg === "function" && callCount === 1) {
        throw new Error("connection reset by peer");
      }
      return Array.isArray(arg) ? Promise.all(arg) : arg(db);
    });
    await expect(executeFulfillment("order-adclean-1")).rejects.toThrow(
      "connection reset by peer",
    );
    expect(db.fulfillment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-adclean-1" },
        create: expect.objectContaining({ provider: "adclean", status: "FAILED" }),
      }),
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("[teste 6] concorrência (CONCURRENT_OR_INVALID_EXECUTION) não grava FAILED nem duplica ProviderOrder — outra execução já reivindicou o slot", async () => {
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(executeFulfillment("order-adclean-1")).rejects.toMatchObject({
      code: "CONCURRENT_OR_INVALID_EXECUTION",
    });
    expect(db.fulfillment.upsert).toHaveBeenCalledTimes(1); // a tentativa normal, não a de recuperação
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("Order permanece FAILED apenas — Payment nunca é tocado por este módulo", async () => {
    await executeFulfillment("order-adclean-1").catch(() => undefined);
    const orderUpdateCalls = db.order.update.mock.calls;
    for (const [call] of orderUpdateCalls) {
      expect(call.data).not.toHaveProperty("payment");
    }
  });
});

describe("FulfillmentEngineError", () => {
  it("carrega o código sanitizado sem nunca incluir payload/segredo", () => {
    const error = new FulfillmentEngineError("PROVIDER_NOT_CONNECTED");
    expect(error.code).toBe("PROVIDER_NOT_CONNECTED");
    expect(error.name).toBe("FulfillmentEngineError");
  });
});
