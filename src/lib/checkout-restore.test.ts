import { describe, expect, it } from "vitest";
import {
  GUEST_DELIVERED_RESTORE_MINUTES,
  deliveredAtFromEvents,
  restoreNow,
  shouldRestoreOrder,
} from "./checkout-restore";
import type { OrderDTO } from "./dto";

const NOW = new Date("2026-11-04T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const order = (orderStatus: string, paymentStatus: string, serverTime = NOW.toISOString()): OrderDTO => ({
  id: "order-1", publicToken: "token", status: orderStatus as OrderDTO["status"], totalCents: 2900, createdAt: minutesAgo(60 * 24 * 5), items: [],
  payment: { status: paymentStatus as NonNullable<OrderDTO["payment"]>["status"], amountCents: 2900, externalPaymentId: "pay-1", pixPayload: "pix", qrCodeImage: null, expirationDate: NOW, serverTime },
  fulfillment: null, events: [],
});

const decide = (o: OrderDTO, deliveredAt: Date | null, viewerLoggedIn: boolean) =>
  shouldRestoreOrder({ order: o, deliveredAt, now: NOW, viewerLoggedIn });

describe("shouldRestoreOrder — pedidos ativos sempre restauram", () => {
  const active = [
    ["PENDING_PAYMENT", "PENDING"],
    ["PENDING_PAYMENT", "EXPIRED"],
    ["PAID", "PAID"],
    ["PROCESSING", "PAID"],
  ] as const;
  for (const [status, payment] of active) {
    for (const viewerLoggedIn of [true, false]) {
      for (const deliveredAt of [null, minutesAgo(60 * 24 * 10)]) {
        it(`${status}/${payment} logado=${viewerLoggedIn} deliveredAt=${deliveredAt ? "antigo" : "null"} → restore`, () => {
          expect(decide(order(status, payment), deliveredAt, viewerLoggedIn)).toBe("restore");
        });
      }
    }
  }
});

describe("shouldRestoreOrder — DELIVERED", () => {
  const delivered = order("DELIVERED", "PAID");

  it("cliente logado nunca restaura, mesmo entregue agora", () => {
    expect(decide(delivered, NOW, true)).toBe("forget");
    expect(decide(delivered, minutesAgo(5), true)).toBe("forget");
  });

  it("visitante restaura em 0 e em 30 minutos", () => {
    expect(GUEST_DELIVERED_RESTORE_MINUTES).toBe(30);
    expect(decide(delivered, NOW, false)).toBe("restore");
    expect(decide(delivered, minutesAgo(30), false)).toBe("restore");
  });

  it("visitante esquece em 31 minutos e depois de dias", () => {
    expect(decide(delivered, minutesAgo(31), false)).toBe("forget");
    expect(decide(delivered, minutesAgo(60 * 24 * 3), false)).toBe("forget");
  });

  it("visitante esquece sem data de entrega ou com data no futuro", () => {
    expect(decide(delivered, null, false)).toBe("forget");
    expect(decide(delivered, new Date(NOW.getTime() + 60_000), false)).toBe("forget");
  });

  it("respeita janela customizada", () => {
    expect(shouldRestoreOrder({ order: delivered, deliveredAt: minutesAgo(10), now: NOW, viewerLoggedIn: false, windowMinutes: 5 })).toBe("forget");
  });
});

describe("shouldRestoreOrder — terminais sem entrega esquecem", () => {
  const cases = [
    ["FAILED", "FAILED"],
    ["CANCELLED", "PENDING"],
    ["CANCELLED", "PAID"],
    ["PAID", "EXPIRED"],
    ["PROCESSING", "REFUNDED"],
  ] as const;
  for (const [status, payment] of cases) {
    for (const viewerLoggedIn of [true, false]) {
      it(`${status}/${payment} logado=${viewerLoggedIn} → forget`, () => {
        expect(decide(order(status, payment), NOW, viewerLoggedIn)).toBe("forget");
      });
    }
  }
});

describe("deliveredAtFromEvents", () => {
  it("retorna null sem evento DELIVERED", () => {
    expect(deliveredAtFromEvents([])).toBeNull();
    expect(deliveredAtFromEvents(undefined)).toBeNull();
    expect(deliveredAtFromEvents([{ status: "PAID", createdAt: minutesAgo(10) }])).toBeNull();
  });

  it("retorna o primeiro evento DELIVERED (aceita string ISO do JSON)", () => {
    const events = [
      { status: "PAID", createdAt: minutesAgo(20).toISOString() },
      { status: "DELIVERED", createdAt: minutesAgo(5).toISOString() },
      { status: "DELIVERED", createdAt: minutesAgo(15).toISOString() },
    ];
    expect(deliveredAtFromEvents(events)?.toISOString()).toBe(minutesAgo(15).toISOString());
  });
});

describe("restoreNow", () => {
  it("usa payment.serverTime quando existe", () => {
    expect(restoreNow(order("DELIVERED", "PAID", "2026-01-01T00:00:00.000Z")).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("cai no relógio local sem payment", () => {
    const before = Date.now();
    const now = restoreNow({ payment: null }).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});
