import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>,
  order: {} as Record<string, unknown>,
  events: [] as string[],
  creates: 0,
  cancels: 0,
  cancelResult: "CANCELLED" as string,
}));

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && "lte" in (want as Row))
      return (row[key] as Date).getTime() <= (want as { lte: Date }).lte.getTime();
    return row[key] === want;
  });

const db = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(db, {
  payment: {
    findUnique: vi.fn(async () => ({ ...state.payment })),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      if (!matches(state.payment, where)) return { count: 0 };
      Object.assign(state.payment, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ data }: { data: Row }) => {
      Object.assign(state.payment, data);
      return state.payment;
    }),
  },
  order: {
    findUnique: vi.fn(async () => ({
      ...state.order,
      payment: { ...state.payment },
      customer: { id: "u1", name: "Fake", email: "fake@example.test", cpfCnpj: "00000000000", whatsapp: null, asaasCustomerId: "cus_fake" },
    })),
  },
  orderEvent: {
    create: vi.fn(async ({ data }: { data: { note: string } }) => {
      state.events.push(data.note);
    }),
  },
  user: { update: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({ executeFulfillment: vi.fn(), safeErrorInfo: vi.fn() }));
vi.mock("@/lib/payments/registry", () => ({
  configuredPaymentProviderCode: () => "asaas",
  getPaymentProvider: () => ({
    code: "asaas",
    createPixPayment: vi.fn(async () => {
      state.creates += 1;
      return { externalPaymentId: `pay_new_${state.creates}`, status: "PENDING", pixCode: "fake-pix", qrCode: "fake-qr", expiresAt: new Date() };
    }),
    cancelPayment: vi.fn(async () => {
      state.cancels += 1;
      if (state.cancelResult === "THROW") throw new Error("boom");
      return state.cancelResult;
    }),
  }),
}));

import { expirePixIfDue } from "./payment-expiry";
import { renewPixPayment } from "./commerce";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const base = (): Row => ({
  id: "pay-1", orderId: "order-1", provider: "asaas", status: "PENDING", externalPaymentId: "pay_old",
  providerReference: "pay_old", pixCode: "fake-pix", qrCode: "fake-qr", amountCents: 2000,
  expiresAt: new Date(NOW.getTime() + 60_000),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.payment = base();
  state.order = { id: "order-1", publicToken: "tok-fake", status: "PENDING_PAYMENT", totalCents: 2000, customerId: "u1" };
  state.events = [];
  state.creates = 0;
  state.cancels = 0;
  state.cancelResult = "CANCELLED";
});

describe("expiração do PIX", () => {
  it("dentro do prazo: nada muda e nada é cancelado", async () => {
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("NOT_DUE");
    expect(state.payment.status).toBe("PENDING");
    expect(state.cancels).toBe(0);
  });
  it("expirado: marca EXPIRED e cancela a cobrança uma única vez", async () => {
    state.payment.expiresAt = new Date(NOW.getTime() - 1);
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("EXPIRED");
    expect(state.payment.status).toBe("EXPIRED");
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("cobrança cancelada");
  });
  it("cancelamento é idempotente: chamadas repetidas ou concorrentes cancelam só uma vez", async () => {
    state.payment.expiresAt = new Date(NOW.getTime() - 1);
    const results = await Promise.all([expirePixIfDue("order-1", NOW), expirePixIfDue("order-1", NOW), expirePixIfDue("order-1", NOW)]);
    expect(results.filter((r) => r === "EXPIRED")).toHaveLength(1);
    await expirePixIfDue("order-1", NOW);
    expect(state.cancels).toBe(1);
  });
  it("só expira Payment ainda PENDING (PAID nunca é tocado nem cancelado)", async () => {
    state.payment.status = "PAID";
    state.payment.expiresAt = new Date(NOW.getTime() - 1);
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("NOT_DUE");
    expect(state.payment.status).toBe("PAID");
    expect(state.cancels).toBe(0);
  });
  it.each(["UNCERTAIN", "THROW"])("erro ambíguo (%s) mantém EXPIRED, marca revisão manual e não repete", async (result) => {
    state.cancelResult = result;
    state.payment.expiresAt = new Date(NOW.getTime() - 1);
    await expirePixIfDue("order-1", NOW);
    await expirePixIfDue("order-1", NOW);
    expect(state.payment.status).toBe("EXPIRED");
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("REVISÃO MANUAL");
  });
});

describe("Gerar novo PIX", () => {
  beforeEach(() => {
    state.payment.status = "EXPIRED";
    state.payment.expiresAt = new Date(NOW.getTime() - 1);
  });

  it("cria uma nova cobrança na MESMA linha de Payment, com nova validade de 30 min", async () => {
    const before = Date.now();
    await renewPixPayment("order-1");
    expect(state.creates).toBe(1);
    expect(state.payment.status).toBe("PENDING");
    expect(state.payment.externalPaymentId).toBe("pay_new_1");
    expect(state.payment.id).toBe("pay-1");
    const exp = (state.payment.expiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 30 * 60 * 1000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 60 * 1000);
    expect(state.events.join()).toContain("cobrança anterior pay_old");
  });
  it("cliques concorrentes e repetidos geram no máximo uma nova cobrança", async () => {
    const results = await Promise.allSettled([renewPixPayment("order-1"), renewPixPayment("order-1"), renewPixPayment("order-1")]);
    await renewPixPayment("order-1").catch(() => undefined);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(state.creates).toBe(1);
    expect(state.payment.externalPaymentId).toBe("pay_new_1");
  });
  it("PIX ainda válido: clicar não cria cobrança nova", async () => {
    state.payment = { ...base(), expiresAt: new Date(Date.now() + 60_000) };
    await renewPixPayment("order-1");
    expect(state.creates).toBe(0);
    expect(state.payment.externalPaymentId).toBe("pay_old");
  });
  it("pedido já pago não permite novo PIX", async () => {
    state.payment.status = "PAID";
    state.order.status = "PAID";
    await expect(renewPixPayment("order-1")).rejects.toThrow("PIX_RENEW_NOT_ALLOWED");
    expect(state.creates).toBe(0);
  });
});
