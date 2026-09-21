import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  payment: {} as Record<string, unknown>,
  order: {} as Record<string, unknown>,
  events: [] as string[],
  orderUpdates: [] as Row[],
  creates: 0,
  cancels: 0,
  cancelResult: "CANCELLED" as string,
}));

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && ("lte" in (want as Row) || "gt" in (want as Row))) {
      const value = (row[key] as Date).getTime();
      const { lte, gt } = want as { lte?: Date; gt?: Date };
      return (lte === undefined || value <= lte.getTime()) && (gt === undefined || value > gt.getTime());
    }
    return row[key] === want;
  });

const db = vi.hoisted(() => ({}) as Record<string, unknown>);
Object.assign(db, {
  payment: {
    findUnique: vi.fn(async () => ({ ...state.payment })),
    findFirst: vi.fn(async () => ({ ...state.payment, order: { ...state.order } })),
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
  paymentEvent: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({})) },
  order: {
    findUnique: vi.fn(async () => ({
      ...state.order,
      payment: { ...state.payment },
      customer: { id: "u1", name: "Fake", email: "fake@example.test", cpfCnpj: "00000000000", whatsapp: null, asaasCustomerId: "cus_fake" },
    })),
    update: vi.fn(async ({ data }: { data: Row }) => {
      state.orderUpdates.push(data);
      Object.assign(state.order, { status: data.status });
      return state.order;
    }),
  },
  orderEvent: {
    create: vi.fn(async ({ data }: { data: { note: string } }) => {
      state.events.push(data.note);
    }),
  },
  user: { update: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => Promise<unknown>)(db),
  ),
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
const executeFulfillment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fulfillment-engine", () => ({ executeFulfillment, safeErrorInfo: vi.fn() }));
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

import { cancelPixByCustomer, expirePixIfDue } from "./payment-expiry";
import { processPayment, renewPixPayment } from "./commerce";
import { PIX_LEGACY_GRACE_MS, PIX_VALIDITY_MS } from "./payments/pix-expiry";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const YEAR = 365 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  state.payment = {
    id: "pay-1", orderId: "order-1", provider: "asaas", status: "PENDING", externalPaymentId: "pay_old",
    providerReference: "pay_old", pixCode: "fake-pix", qrCode: "fake-qr", amountCents: 1200,
    expiresAt: new Date(NOW.getTime() + 60_000),
  };
  state.order = { id: "order-1", publicToken: "tok-fake", status: "PENDING_PAYMENT", totalCents: 1200, customerId: "u1" };
  state.events = [];
  state.orderUpdates = [];
  state.creates = 0;
  state.cancels = 0;
  state.cancelResult = "CANCELLED";
});

describe("PIX legado (expiresAt além de agora + validade)", () => {
  it("é tratado como expirado pelo mesmo caminho, com um único DELETE", async () => {
    state.payment.expiresAt = new Date(NOW.getTime() + YEAR);
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("EXPIRED");
    expect(state.payment.status).toBe("EXPIRED");
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("legado");
    await expirePixIfDue("order-1", NOW);
    expect(state.cancels).toBe(1);
  });
  it("consultas concorrentes cancelam no máximo uma vez", async () => {
    state.payment.expiresAt = new Date(NOW.getTime() + YEAR);
    const results = await Promise.all([1, 2, 3, 4].map(() => expirePixIfDue("order-1", NOW)));
    expect(results.filter((r) => r === "EXPIRED")).toHaveLength(1);
    expect(state.cancels).toBe(1);
  });
  it("erro ambíguo: mantém EXPIRED, registra REVISÃO MANUAL e não repete", async () => {
    state.cancelResult = "UNCERTAIN";
    state.payment.expiresAt = new Date(NOW.getTime() + YEAR);
    await expirePixIfDue("order-1", NOW);
    await expirePixIfDue("order-1", NOW);
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("REVISÃO MANUAL");
  });
  it("PIX normal (até validade + 60 s) NÃO é tratado como legado", async () => {
    state.payment.expiresAt = new Date(NOW.getTime() + PIX_VALIDITY_MS + PIX_LEGACY_GRACE_MS);
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("NOT_DUE");
    expect(state.payment.status).toBe("PENDING");
    expect(state.cancels).toBe(0);
  });
  it("Payment PAID com expiresAt legado nunca é tocado", async () => {
    state.payment.status = "PAID";
    state.payment.expiresAt = new Date(NOW.getTime() + YEAR);
    await expect(expirePixIfDue("order-1", NOW)).resolves.toBe("NOT_DUE");
    expect(state.cancels).toBe(0);
  });
  it("regeneração continua funcionando e nunca passa de agora + validade", async () => {
    state.payment.expiresAt = new Date(Date.now() + YEAR);
    await renewPixPayment("order-1");
    expect(state.creates).toBe(1);
    expect(state.payment.status).toBe("PENDING");
    expect((state.payment.expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + PIX_VALIDITY_MS);
  });
});

describe("Cancelar e começar de novo", () => {
  it("expira o Payment, mantém o Order PENDING_PAYMENT e cancela no provedor uma vez", async () => {
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("CANCELLED");
    expect(state.payment.status).toBe("EXPIRED");
    expect(state.order.status).toBe("PENDING_PAYMENT");
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("cancelado pelo cliente");
  });
  it("é idempotente: repetir não cancela de novo", async () => {
    await cancelPixByCustomer("order-1");
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("ALREADY_HANDLED");
    expect(state.cancels).toBe(1);
  });
  it("cliques concorrentes: um único DELETE no provedor", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => cancelPixByCustomer("order-1")));
    expect(results.filter((r) => r === "CANCELLED")).toHaveLength(1);
    expect(state.cancels).toBe(1);
  });
  it.each(["REJECTED", "UNCERTAIN", "THROW"])("DELETE %s: não é sucesso — MANUAL_REVIEW, REVISÃO MANUAL registrada, sem repetir", async (result) => {
    state.cancelResult = result;
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("MANUAL_REVIEW");
    await cancelPixByCustomer("order-1");
    expect(state.payment.status).toBe("EXPIRED");
    expect(state.cancels).toBe(1);
    expect(state.events.join()).toContain("REVISÃO MANUAL");
  });
  it.each(["PAID", "FAILED", "REFUNDED"])("Payment %s: não age", async (status) => {
    state.payment.status = status;
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("NOT_PENDING");
    expect(state.payment.status).toBe(status);
    expect(state.cancels).toBe(0);
  });
  it.each(["PAID", "PROCESSING", "DELIVERED"])("Order %s: não age nem com Payment PENDING", async (status) => {
    state.order.status = status;
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("NOT_PENDING");
    expect(state.payment.status).toBe("PENDING");
    expect(state.cancels).toBe(0);
  });
  it("cobrança ainda sendo criada (sem externalPaymentId) não é cancelada", async () => {
    state.payment.externalPaymentId = null;
    await expect(cancelPixByCustomer("order-1")).resolves.toBe("NOT_PENDING");
    expect(state.cancels).toBe(0);
  });
  it("PIX pago depois do cancelamento: webhook vira PAID, entrega segue e sinaliza REVISÃO MANUAL", async () => {
    await cancelPixByCustomer("order-1");
    await processPayment(
      { provider: "asaas", providerEventId: "evt-late", externalPaymentId: "pay_old", status: "PAID" as never, payload: {} },
      vi.fn(),
    );
    expect(state.payment.status).toBe("PAID");
    expect(state.orderUpdates[0].status).toBe("PAID");
    const note = (state.orderUpdates[0].events as { create: { note: string } }).create.note;
    expect(note).toContain("REVISÃO MANUAL");
    expect(executeFulfillment).toHaveBeenCalledWith("order-1");
  });
  it("depois de cancelar, Gerar novo PIX continua funcionando", async () => {
    await cancelPixByCustomer("order-1");
    await renewPixPayment("order-1");
    expect(state.creates).toBe(1);
    expect(state.payment.status).toBe("PENDING");
  });
});
