import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "./route";

const request = new Request("http://localhost/api/orders/order-code/delivery", {
  headers: { authorization: "Bearer isolated-test-token" },
});

describe("secure customer delivery endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.deliveryAccessAttempt.count.mockResolvedValue(0);
    db.order.findUnique.mockResolvedValue({
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
    });
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
      ...(await db.order.findUnique()),
      status: "PROCESSING",
    });
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect((await response.json()).data.delivery).toBeNull();
  });
});
