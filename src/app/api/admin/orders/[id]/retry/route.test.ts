import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, executeFulfillment, reconcileFulfillment, audit, db } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  executeFulfillment: vi.fn(),
  reconcileFulfillment: vi.fn(),
  audit: vi.fn(),
  db: { order: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({
  executeFulfillment,
  reconcileFulfillment,
  FulfillmentEngineError: class FulfillmentEngineError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "FulfillmentEngineError";
    }
  },
}));
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ id: "order-1" }) };
const req = (method: string) =>
  new Request("https://test/api/admin/orders/order-1/retry", { method });

describe("retry/recover de fulfillment — decide entre 1ª execução, retry limpo e reconciliação", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    executeFulfillment.mockReset();
    reconcileFulfillment.mockReset();
    audit.mockReset();
    db.order.findUnique.mockReset();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("GET: permite retry quando nunca houve ProviderOrder (Fulfillment inexistente) — o incidente real do AdClean (print 17/09)", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "PAID",
      payment: { status: "PAID" },
      fulfillment: null,
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: {
        allowed: true,
        action: "RETRY",
        message: "Pagamento confirmado. A liberação ainda não foi iniciada.",
      },
    });
  });

  it("GET: permite retry quando Fulfillment(FAILED) existe mas sem ProviderOrder (rede de segurança da Wave anterior)", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: { delivery: null, providerOrders: [] },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: {
        allowed: true,
        action: "RETRY",
        message: "Pagamento confirmado. A liberação ainda não foi iniciada.",
      },
    });
  });

  it("GET: aponta RECONCILE (não bloqueia mais sem ação nenhuma) quando já existe ProviderOrder com resultado incerto", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: {
        delivery: null,
        providerOrders: [
          {
            status: "PROCESSING",
            attempts: 1,
            requestReference: "provider-order-1",
            externalOrderId: null,
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            _count: { callbackEvents: 0 },
          },
        ],
      },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: {
        allowed: true,
        action: "RECONCILE",
        message:
          "Pagamento confirmado. Estamos verificando uma tentativa anterior com o provider.",
      },
    });
  });

  it("GET: permite retry quando existe ProviderOrder FAILED limpo e elegível (comportamento pré-existente preservado)", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: {
        delivery: null,
        providerOrders: [
          {
            status: "FAILED",
            attempts: 1,
            requestReference: null,
            externalOrderId: null,
            lastError: null,
            _count: { callbackEvents: 0 },
          },
        ],
      },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: {
        allowed: true,
        action: "RETRY",
        message: "Pagamento confirmado. A liberação ainda não foi iniciada.",
      },
    });
  });

  it("GET: bloqueia recovery quando o pedido já está DELIVERED", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "DELIVERED",
      payment: { status: "PAID" },
      fulfillment: null,
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: { allowed: false, action: null, message: "Entrega já concluída." },
    });
  });

  it("GET: bloqueia recovery quando o pagamento não está PAID", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "PENDING_PAYMENT",
      payment: { status: "PENDING" },
      fulfillment: null,
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({
      data: { allowed: false, action: null, message: "Recuperação indisponível para este pedido." },
    });
  });

  it("POST: chama executeFulfillment SEM retry quando nunca houve ProviderOrder", async () => {
    db.order.findUnique.mockResolvedValue({ fulfillment: null });
    executeFulfillment.mockResolvedValue({ status: "COMPLETED" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(200);
    expect(executeFulfillment).toHaveBeenCalledWith("order-1", { retry: false });
    expect(reconcileFulfillment).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith("admin-1", "FULFILLMENT_RECOVER", "Order", "order-1", { result: "accepted" });
  });

  it("POST: chama executeFulfillment COM retry quando existe ProviderOrder limpo (sem evidência externa)", async () => {
    db.order.findUnique.mockResolvedValue({
      fulfillment: {
        providerOrders: [
          {
            id: "po-1",
            status: "FAILED",
            attempts: 1,
            requestReference: null,
            externalOrderId: null,
            lastError: null,
            _count: { callbackEvents: 0 },
          },
        ],
      },
    });
    executeFulfillment.mockResolvedValue({ status: "COMPLETED" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(200);
    expect(executeFulfillment).toHaveBeenCalledWith("order-1", { retry: true });
    expect(reconcileFulfillment).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith("admin-1", "FULFILLMENT_RETRY", "Order", "order-1", { result: "accepted" });
  });

  it("POST: chama reconcileFulfillment (NUNCA executeFulfillment) quando existe evidência de tentativa externa", async () => {
    db.order.findUnique.mockResolvedValue({
      fulfillment: {
        providerOrders: [
          {
            id: "po-1",
            status: "PROCESSING",
            attempts: 1,
            requestReference: "po-1",
            externalOrderId: null,
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            _count: { callbackEvents: 0 },
          },
        ],
      },
    });
    reconcileFulfillment.mockResolvedValue({ status: "PROCESSING" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(200);
    expect(reconcileFulfillment).toHaveBeenCalledWith("order-1");
    expect(executeFulfillment).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith("admin-1", "FULFILLMENT_RECONCILE", "Order", "order-1", { result: "accepted" });
  });

  it("bloqueia caller não-admin em GET e POST", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await GET(req("GET"), ctx)).status).toBe(403);
    expect((await POST(req("POST"), ctx)).status).toBe(403);
    expect(executeFulfillment).not.toHaveBeenCalled();
    expect(reconcileFulfillment).not.toHaveBeenCalled();
  });
});
