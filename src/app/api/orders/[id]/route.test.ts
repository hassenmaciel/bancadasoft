import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrder, session, canReadOrder, attemptAutomaticGuestRecovery } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  session: vi.fn(),
  canReadOrder: vi.fn(),
  attemptAutomaticGuestRecovery: vi.fn(),
}));
vi.mock("@/lib/commerce", () => ({ getOrder }));
vi.mock("@/lib/auth", () => ({ session }));
vi.mock("@/lib/public-navigation", () => ({ canReadOrder }));
vi.mock("@/lib/fulfillment-engine", () => ({ attemptAutomaticGuestRecovery }));

import { GET } from "./route";

const req = (id: string, token?: string) =>
  new Request(`https://test/api/orders/${id}${token ? `?token=${token}` : ""}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const baseOrder = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  publicToken: "public-token-1",
  customerId: "customer-1",
  status: "PROCESSING",
  totalCents: 2000,
  createdAt: new Date("2026-09-17T00:00:00Z"),
  payment: { status: "PAID", amountCents: 2000, externalPaymentId: null, pixCode: "", qrCode: null, expiresAt: new Date() },
  fulfillment: { status: "PROCESSING", delivery: null },
  items: [],
  events: [],
  ...overrides,
});

describe("GET /api/orders/[id] — status guest/autenticado com recovery automático embutido", () => {
  beforeEach(() => {
    getOrder.mockReset();
    session.mockReset();
    canReadOrder.mockReset();
    attemptAutomaticGuestRecovery.mockReset();
    session.mockResolvedValue(null);
    canReadOrder.mockReturnValue(false);
  });

  it("404 quando o pedido não existe", async () => {
    getOrder.mockResolvedValue(null);
    const response = await GET(req("order-x"), ctx("order-x"));
    expect(response.status).toBe(404);
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });

  it("403 quando o token não bate e não há sessão autorizada", async () => {
    getOrder.mockResolvedValue(baseOrder());
    const response = await GET(req("order-1", "token-errado"), ctx("order-1"));
    expect(response.status).toBe(403);
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });

  it("NÃO aciona recovery automático quando o pagamento ainda não está PAID", async () => {
    getOrder.mockResolvedValue(
      baseOrder({ status: "PENDING_PAYMENT", payment: { status: "PENDING", amountCents: 2000, externalPaymentId: null, pixCode: "x", qrCode: null, expiresAt: new Date() } }),
    );
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(200);
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });

  it("NÃO aciona recovery automático quando o pedido já está DELIVERED", async () => {
    getOrder.mockResolvedValue(baseOrder({ status: "DELIVERED" }));
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(200);
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });

  it("aciona recovery automático quando PAID e ainda sem entrega, e relê o pedido quando algo foi tentado", async () => {
    getOrder
      .mockResolvedValueOnce(baseOrder({ status: "FAILED" }))
      .mockResolvedValueOnce(baseOrder({ status: "DELIVERED" }));
    attemptAutomaticGuestRecovery.mockResolvedValue(true);
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    const payload = await response.json();
    expect(attemptAutomaticGuestRecovery).toHaveBeenCalledWith("order-1");
    expect(getOrder).toHaveBeenCalledTimes(2);
    expect(payload.data.status).toBe("DELIVERED");
  });

  it("não relê o pedido quando o recovery automático foi throttlado (nada foi tentado)", async () => {
    getOrder.mockResolvedValue(baseOrder({ status: "FAILED" }));
    attemptAutomaticGuestRecovery.mockResolvedValue(false);
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(200);
    expect(getOrder).toHaveBeenCalledTimes(1);
  });

  it("uma falha no recovery automático nunca derruba a resposta de status", async () => {
    getOrder.mockResolvedValue(baseOrder({ status: "FAILED" }));
    attemptAutomaticGuestRecovery.mockRejectedValue(new Error("boom"));
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(200);
  });

  it("endpoint público (token) nunca inclui Delivery no corpo", async () => {
    getOrder.mockResolvedValue(
      baseOrder({ status: "DELIVERED", fulfillment: { status: "FULFILLED", delivery: { credential: "SECRET-CODE" } } }),
    );
    const response = await GET(req("order-1", "public-token-1"), ctx("order-1"));
    const payload = await response.json();
    expect(payload.data.fulfillment.delivery).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("SECRET-CODE");
  });
});
