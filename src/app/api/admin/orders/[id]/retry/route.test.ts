import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, executeFulfillment, audit, db } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  executeFulfillment: vi.fn(),
  audit: vi.fn(),
  db: { order: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({
  executeFulfillment,
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

describe("retry/recover de fulfillment — decide automaticamente entre primeira execução e retry", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    executeFulfillment.mockReset();
    audit.mockReset();
    db.order.findUnique.mockReset();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("GET: permite quando nunca houve ProviderOrder (Fulfillment inexistente) — o incidente real do AdClean", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "PAID",
      payment: { status: "PAID" },
      fulfillment: null,
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({ data: { allowed: true, reason: null } });
  });

  it("GET: permite quando Fulfillment(FAILED) existe mas sem ProviderOrder (rede de segurança da Wave anterior)", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: { providerOrders: [] },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({ data: { allowed: true, reason: null } });
  });

  it("GET: continua exigindo reconciliação quando já existe ProviderOrder com resultado incerto", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: { providerOrders: [{ status: "FAILED", attempts: 1, requestReference: "req-1", externalOrderId: null, lastError: null, _count: { callbackEvents: 0 } }] },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({ data: { allowed: false, reason: "RECONCILIATION_REQUIRED" } });
  });

  it("GET: permite quando existe ProviderOrder FAILED limpo e elegível para retry (comportamento pré-existente preservado)", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: { providerOrders: [{ status: "FAILED", attempts: 1, requestReference: null, externalOrderId: null, lastError: null, _count: { callbackEvents: 0 } }] },
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({ data: { allowed: true, reason: null } });
  });

  it("GET: bloqueia recovery quando o pedido já está DELIVERED", async () => {
    db.order.findUnique.mockResolvedValue({
      status: "DELIVERED",
      payment: { status: "PAID" },
      fulfillment: null,
    });
    const response = await GET(req("GET"), ctx);
    expect(await response.json()).toEqual({ data: { allowed: false, reason: "RECONCILIATION_REQUIRED" } });
  });

  it("POST: chama executeFulfillment SEM retry quando nunca houve ProviderOrder", async () => {
    db.order.findUnique.mockResolvedValue({ fulfillment: null });
    executeFulfillment.mockResolvedValue({ status: "COMPLETED" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(200);
    expect(executeFulfillment).toHaveBeenCalledWith("order-1", { retry: false });
    expect(audit).toHaveBeenCalledWith("admin-1", "FULFILLMENT_RECOVER", "Order", "order-1", { result: "accepted" });
  });

  it("POST: chama executeFulfillment COM retry quando já existe ProviderOrder", async () => {
    db.order.findUnique.mockResolvedValue({ fulfillment: { providerOrders: [{ id: "po-1" }] } });
    executeFulfillment.mockResolvedValue({ status: "COMPLETED" });
    const response = await POST(req("POST"), ctx);
    expect(response.status).toBe(200);
    expect(executeFulfillment).toHaveBeenCalledWith("order-1", { retry: true });
    expect(audit).toHaveBeenCalledWith("admin-1", "FULFILLMENT_RETRY", "Order", "order-1", { result: "accepted" });
  });

  it("bloqueia caller não-admin em GET e POST", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await GET(req("GET"), ctx)).status).toBe(403);
    expect((await POST(req("POST"), ctx)).status).toBe(403);
    expect(executeFulfillment).not.toHaveBeenCalled();
  });
});
