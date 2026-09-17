import { beforeEach, describe, expect, it, vi } from "vitest";

const { attemptAutomaticGuestRecovery } = vi.hoisted(() => ({
  attemptAutomaticGuestRecovery: vi.fn(),
}));
const db = vi.hoisted(() => ({
  deliveryAccessAttempt: { count: vi.fn(), create: vi.fn() },
  order: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/customer-delivery", async () =>
  import("../../../../../lib/customer-delivery"),
);
vi.mock("@/lib/guest-delivery", () => ({
  DELIVERY_RATE_LIMIT: 10,
  DELIVERY_RATE_WINDOW_MS: 300000,
  deliveryAccessFingerprint: vi.fn(() => "safe-fingerprint"),
  deliveryTokenMatches: vi.fn(() => true),
}));
vi.mock("@/lib/fulfillment-engine", () => ({ attemptAutomaticGuestRecovery }));

import { GET } from "./route";

const request = new Request("http://localhost/api/orders/order-code/delivery", {
  headers: { authorization: "Bearer isolated-test-token" },
});

const deliveredOrderFixture = {
  id: "order-code",
  publicToken: "public-token",
  status: "DELIVERED",
  createdAt: new Date("2026-09-13T12:00:00Z"),
  deliveryTokenHash: "hash",
  deliveryTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  deliveryTokenRevokedAt: null,
  items: [{ product: { name: "FRPFILE Premium" } }],
  payment: { status: "PAID" },
  fulfillment: {
    status: "FULFILLED",
    delivery: {
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
      internalReplay: "must-not-leak",
    },
  },
};

describe("secure customer delivery endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attemptAutomaticGuestRecovery.mockResolvedValue(false);
    db.deliveryAccessAttempt.count.mockResolvedValue(0);
    db.order.findUnique.mockResolvedValue(deliveredOrderFixture);
  });

  it("returns CODE after token validation and strips internal properties", async () => {
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.delivery).toEqual({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
    });
    expect(JSON.stringify(payload)).not.toContain("internalReplay");
  });

  it("does not release delivery before the final order state", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      ...deliveredOrderFixture,
      status: "PROCESSING",
    });
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect((await response.json()).data.delivery).toBeNull();
  });

  it("aciona recovery automático quando PAID sem entrega e reflete a convergência na mesma resposta (backup por e-mail também converge sozinho)", async () => {
    const paidNotDelivered = {
      ...deliveredOrderFixture,
      status: "FAILED",
      fulfillment: { status: "FAILED", delivery: null },
    };
    db.order.findUnique
      .mockResolvedValueOnce(paidNotDelivered)
      .mockResolvedValueOnce(deliveredOrderFixture);
    attemptAutomaticGuestRecovery.mockResolvedValue(true);

    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });

    expect(attemptAutomaticGuestRecovery).toHaveBeenCalledWith("order-code");
    expect(db.order.findUnique).toHaveBeenCalledTimes(2);
    const payload = await response.json();
    expect(payload.data.status).toBe("DELIVERED");
    expect(payload.data.delivery).toEqual({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
    });
  });

  it("NÃO aciona recovery automático quando o pedido já está DELIVERED", async () => {
    await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });
});
