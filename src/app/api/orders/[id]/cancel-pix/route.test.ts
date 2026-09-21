import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrder, session, canReadOrder, cancelPixByCustomer } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  session: vi.fn(),
  canReadOrder: vi.fn(),
  cancelPixByCustomer: vi.fn(),
}));
vi.mock("@/lib/commerce", () => ({ getOrder }));
vi.mock("@/lib/auth", () => ({ session }));
vi.mock("@/lib/public-navigation", () => ({ canReadOrder }));
vi.mock("@/lib/payment-expiry", () => ({ cancelPixByCustomer }));

import { POST } from "./route";

const req = (id: string, token?: string) =>
  new Request(`https://test/api/orders/${id}/cancel-pix${token ? `?token=${token}` : ""}`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const order = () => ({
  id: "order-1", publicToken: "public-token-1", customerId: "customer-1", status: "PENDING_PAYMENT", totalCents: 1200,
  createdAt: new Date("2026-09-17T00:00:00Z"),
  payment: { status: "EXPIRED", amountCents: 1200, externalPaymentId: null, pixCode: "", qrCode: null, expiresAt: new Date() },
  fulfillment: null, items: [], events: [],
});

describe("POST /api/orders/[id]/cancel-pix", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.mockResolvedValue(null);
    canReadOrder.mockReturnValue(false);
  });
  it("404 sem pedido; 403 sem sessão autorizada nem token válido (nada é cancelado)", async () => {
    getOrder.mockResolvedValue(null);
    expect((await POST(req("x"), ctx("x"))).status).toBe(404);
    getOrder.mockResolvedValue(order());
    expect((await POST(req("order-1", "errado"), ctx("order-1"))).status).toBe(403);
    expect(cancelPixByCustomer).not.toHaveBeenCalled();
  });
  it("token do pedido autoriza (mesma regra do POST /pix); manualReview sinaliza revisão", async () => {
    getOrder.mockResolvedValue(order());
    cancelPixByCustomer.mockResolvedValue("MANUAL_REVIEW");
    const response = await POST(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(200);
    expect((await response.json()).manualReview).toBe(true);
  });
  it("sessão dona autoriza; cancelamento normal não sinaliza revisão", async () => {
    getOrder.mockResolvedValue(order());
    session.mockResolvedValue({ id: "customer-1", role: "CUSTOMER" });
    canReadOrder.mockReturnValue(true);
    cancelPixByCustomer.mockResolvedValue("CANCELLED");
    const body = await (await POST(req("order-1"), ctx("order-1"))).json();
    expect(body.manualReview).toBe(false);
  });
  it("409 quando o pedido não permite cancelar (pago/entregue)", async () => {
    getOrder.mockResolvedValue(order());
    cancelPixByCustomer.mockResolvedValue("NOT_PENDING");
    const response = await POST(req("order-1", "public-token-1"), ctx("order-1"));
    expect(response.status).toBe(409);
  });
});
