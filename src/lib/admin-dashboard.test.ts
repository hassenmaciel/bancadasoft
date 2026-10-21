import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
const query = <T,>(name: string, value: T) => vi.fn(async () => {
  calls.push(name);
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 1));
  inFlight -= 1;
  return value;
});

// order.count serve "Pedidos hoje" (where.createdAt) e as 6 contagens de atenção:
// separa as duas para conferir o where de cada uma.
const ordersTodayCount = vi.fn((_args: { where: { createdAt: { gte: Date } } }) => 2);
const attentionCount = vi.fn((_args: { where: unknown }) => 2);

const prismaMock = vi.hoisted(() => ({ current: {} as Record<string, Record<string, unknown>> }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, key) => prismaMock.current[key as string] }) }));

import { getAdminDashboard } from "./admin-dashboard";

describe("getAdminDashboard", () => {
  beforeEach(() => {
    calls.length = 0; inFlight = 0; maxInFlight = 0;
    ordersTodayCount.mockClear(); attentionCount.mockClear();
    prismaMock.current = {
      order: {
        groupBy: query("order.groupBy", [{ status: "PENDING_PAYMENT", _count: 3 }, { status: "DELIVERED", _count: 5 }]),
        count: vi.fn(async (args: { where: Record<string, unknown> }) => {
          calls.push("order.count"); inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 1)); inFlight -= 1;
          return "createdAt" in args.where
            ? ordersTodayCount(args as { where: { createdAt: { gte: Date } } })
            : attentionCount(args);
        }),
        findMany: query("order.findMany", [{ id: "o1" }]),
      },
      payment: {
        groupBy: query("payment.groupBy", [{ status: "PAID", _count: 4 }]),
        aggregate: query("payment.aggregate", { _sum: { amountCents: 1000 }, _avg: { amountCents: 250.4 } }),
      },
      product: { groupBy: query("product.groupBy", [{ status: "PUBLISHED", _count: 7 }, { status: "DRAFT", _count: 1 }]) },
      user: { count: query("user.count", 9) },
    };
  });

  it("keeps the same metrics and runs the 7 independent queries plus the 6 attention counts concurrently", async () => {
    const data = await getAdminDashboard();
    expect(calls).toHaveLength(13);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(data.metrics).toEqual({
      ordersToday: 2, awaiting: 3, paid: 4, processing: 0, completed: 5, failed: 0,
      revenueCents: 1000, averageTicketCents: 250, published: 7, paused: 0, drafts: 1, users: 9, fulfillmentFailed: 2,
    });
    expect(data.attention.map((a) => [a.key, a.count])).toEqual([["FULFILLMENT_FAILED", 2], ["PROVIDER_FAILED", 2], ["NO_FULFILLMENT", 2], ["STUCK", 2], ["MANUAL_REVIEW", 2], ["PROVIDER_REJECTED", 2]]);
    expect(data.attention[0].href).toBe("/admin/pedidos?attention=FULFILLMENT_FAILED");
    expect(data.recent).toEqual([{ id: "o1" }]);
  });

  describe("Pedidos hoje no dia de São Paulo", () => {
    // Só Date é falso: o setTimeout dos mocks continua real.
    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
    afterEach(() => { vi.useRealTimers(); });

    it("às 21h30 de Brasília (00:30Z) conta desde a meia-noite de São Paulo, não desde 00:00Z", async () => {
      vi.setSystemTime(new Date("2026-10-21T00:30:00Z"));
      await getAdminDashboard();
      expect(ordersTodayCount).toHaveBeenCalledTimes(1);
      expect(ordersTodayCount).toHaveBeenCalledWith({ where: { createdAt: { gte: new Date("2026-10-20T03:00:00Z") } } });
      expect(attentionCount).toHaveBeenCalledTimes(6);
    });
  });
});
