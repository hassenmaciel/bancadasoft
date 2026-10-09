import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Banco em memória com a semântica que importa: leituras devolvem CÓPIA,
// updateMany só altera se o where ainda bate com o estado ATUAL (claim
// condicional), PaymentEvent.providerEventId é único (P2002) e transações
// interativas são serializadas e desfeitas por inteiro quando lançam.
type State = {
  order: { id: string; status: string; publicToken: string };
  payment: {
    id: string;
    orderId: string;
    provider: string;
    status: string;
    externalPaymentId: string | null;
    amountCents: number;
  };
  paymentEvents: Array<{ providerEventId: string; paymentId: string; payload: unknown }>;
  orderEvents: Array<{ orderId: string; status: string; note: string }>;
  audits: Array<Record<string, unknown>>;
};

const h = vi.hoisted(() => {
  // p2002 é preenchido depois dos imports (Prisma ainda não existe aqui).
  const holder: { state: State | null; lock: Promise<unknown>; p2002: () => Error } = {
    state: null,
    lock: Promise.resolve(),
    p2002: () => new Error("P2002"),
  };
  const s = () => holder.state as State;
  const orderView = () => ({
    ...structuredClone(s().order),
    payment: structuredClone(s().payment),
    items: [],
    fulfillment: null,
    events: structuredClone(s().orderEvents),
  });
  const db = {
    order: {
      findUnique: vi.fn(async () => orderView()),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        if (s().order.id !== where.id || s().order.status !== where.status) return { count: 0 };
        s().order.status = data.status;
        return { count: 1 };
      }),
      // Usado pelo webhook (processPayment).
      update: vi.fn(async ({ data }: { data: { status: string; events?: { create: { status: string; note: string } } } }) => {
        s().order.status = data.status;
        if (data.events) s().orderEvents.push({ orderId: s().order.id, ...data.events.create });
        return orderView();
      }),
    },
    payment: {
      findFirst: vi.fn(async ({ where }: { where: { externalPaymentId?: string } }) =>
        where.externalPaymentId && where.externalPaymentId !== s().payment.externalPaymentId
          ? null
          : { ...structuredClone(s().payment), order: structuredClone(s().order) },
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; externalPaymentId: string; status: { in: string[] } }; data: { status: string } }) => {
        const p = s().payment;
        if (p.id !== where.id || p.externalPaymentId !== where.externalPaymentId || !where.status.in.includes(p.status)) return { count: 0 };
        p.status = data.status;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Partial<State["payment"]> }) => {
        Object.assign(s().payment, data);
        return structuredClone(s().payment);
      }),
    },
    paymentEvent: {
      findUnique: vi.fn(async ({ where }: { where: { providerEventId: string } }) =>
        s().paymentEvents.find((e) => e.providerEventId === where.providerEventId) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: State["paymentEvents"][number] }) => {
        if (s().paymentEvents.some((e) => e.providerEventId === data.providerEventId)) throw holder.p2002();
        s().paymentEvents.push(structuredClone(data));
        return data;
      }),
    },
    orderEvent: {
      create: vi.fn(async ({ data }: { data: State["orderEvents"][number] }) => {
        s().orderEvents.push(data);
        return data;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        s().audits.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const run = async () => {
        const snapshot = structuredClone(s());
        try {
          return await (arg as (tx: unknown) => Promise<unknown>)(db);
        } catch (error) {
          holder.state = snapshot;
          throw error;
        }
      };
      const next = holder.lock.then(run, run);
      holder.lock = next.catch(() => undefined);
      return next;
    }),
  };
  const engine = {
    executeFulfillment: vi.fn(async (orderId: string) => ({ orderId })),
  };
  return { holder, db, engine };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("./prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/fulfillment-engine", () => ({
  executeFulfillment: h.engine.executeFulfillment,
  safeErrorInfo: (error: unknown) => ({ name: error instanceof Error ? error.name : "UnknownError", code: "FULFILLMENT_INTERNAL_ERROR" }),
}));
vi.mock("./fulfillment-engine", () => ({
  executeFulfillment: h.engine.executeFulfillment,
  safeErrorInfo: (error: unknown) => ({ name: error instanceof Error ? error.name : "UnknownError", code: "FULFILLMENT_INTERNAL_ERROR" }),
}));

import { PaymentReconcileError, reconcileAsaasPayment } from "./admin-payment-reconcile";
import { handleAdminPaymentReconcile } from "./admin-payment-reconcile-route";
import { processPayment } from "./commerce";
import { AsaasPaymentProvider } from "./payments/asaas";
import { AsaasClientError } from "./payments/asaas-client";
import { customerVisibleEvents } from "./dto";

h.holder.p2002 = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint", { code: "P2002", clientVersion: "test" });

const EXT = "pay_9t86dj658le7ebta";
const TOKEN = "1411391c801c4fdf97001e58a90cc6be";
const input = { orderId: "order-1", adminId: "admin-1" };
const received = () => ({ id: EXT, status: "RECEIVED", value: 32, externalReference: TOKEN });

function seed(overrides: { order?: Partial<State["order"]>; payment?: Partial<State["payment"]> } = {}) {
  h.holder.state = {
    order: { id: "order-1", status: "PENDING_PAYMENT", publicToken: TOKEN, ...overrides.order },
    payment: {
      id: "payment-1",
      orderId: "order-1",
      provider: "asaas",
      status: "PENDING",
      externalPaymentId: EXT,
      amountCents: 3200,
      ...overrides.payment,
    },
    paymentEvents: [],
    orderEvents: [],
    audits: [],
  };
}
const state = () => h.holder.state as State;
const asaasReturning = (snapshot: ReturnType<typeof received> | (() => Promise<never>)) => {
  const getPayment = vi.fn(async () => (typeof snapshot === "function" ? snapshot() : snapshot));
  return { getPayment, asaas: () => ({ getPayment }) };
};
const unchanged = (before: State) => expect(state()).toEqual(before);

// Webhook PAYMENT_RECEIVED real do Asaas, pelo caminho atual (sem alteração).
const realWebhook = (providerEventId = "evt_real_asaas_1") =>
  processPayment(
    {
      provider: "asaas",
      providerEventId,
      orderId: TOKEN,
      externalPaymentId: EXT,
      status: "PAID" as never,
      payload: { id: providerEventId, event: "PAYMENT_RECEIVED" },
    },
    vi.fn(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.holder.lock = Promise.resolve();
  seed();
});

describe("reconcileAsaasPayment — caminho feliz", () => {
  it("RECEIVED com id, referência e valor batendo: Payment/Order PAID, evento sintético, nota, auditoria e UM fulfillment", async () => {
    const { asaas, getPayment } = asaasReturning(received());
    const result = await reconcileAsaasPayment(input, { asaas });
    expect(result).toEqual({ status: "RECONCILED", previousPaymentStatus: "PENDING", manualReview: false, fulfillment: "EXECUTED" });
    expect(getPayment).toHaveBeenCalledWith(EXT);
    expect(state().payment.status).toBe("PAID");
    expect(state().order.status).toBe("PAID");
    expect(state().paymentEvents).toHaveLength(1);
    expect(state().paymentEvents[0].providerEventId).toBe(`manual-reconcile:${EXT}`);
    expect(state().paymentEvents[0].payload).toMatchObject({ source: "admin-manual-reconcile", adminId: "admin-1", asaas: received() });
    expect(state().orderEvents).toEqual([
      expect.objectContaining({ status: "PAID", note: expect.stringContaining("reconciliação manual") }),
    ]);
    expect(state().orderEvents[0].note).not.toContain("REVISÃO MANUAL");
    expect(state().audits).toEqual([
      expect.objectContaining({ actorUserId: "admin-1", action: "PAYMENT_MANUAL_RECONCILE", entityType: "Order", entityId: "order-1" }),
    ]);
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
    expect(h.engine.executeFulfillment).toHaveBeenCalledWith("order-1");
  });

  it("Payment EXPIRED recebido: confirma com REVISÃO MANUAL (nota escondida do cliente)", async () => {
    seed({ payment: { status: "EXPIRED" } });
    const result = await reconcileAsaasPayment(input, asaasReturning(received()));
    expect(result).toMatchObject({ previousPaymentStatus: "EXPIRED", manualReview: true });
    expect(state().payment.status).toBe("PAID");
    expect(state().orderEvents[0].note).toContain("REVISÃO MANUAL");
    expect(customerVisibleEvents(state().orderEvents.map((e) => ({ ...e, createdAt: new Date() })))).toEqual([]);
    expect(state().audits[0]).toMatchObject({ metadata: expect.objectContaining({ manualReview: true }) });
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
  });

  it("falha no fulfillment não desfaz o PAID e fica registrada em log", async () => {
    h.engine.executeFulfillment.mockRejectedValueOnce(new Error("boom Bearer secret"));
    const log = vi.fn();
    const result = await reconcileAsaasPayment(input, { ...asaasReturning(received()), log });
    expect(result.fulfillment).toBe("FAILED");
    expect(state().payment.status).toBe("PAID");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("fulfillment"), { orderId: "order-1", name: "Error", code: "FULFILLMENT_INTERNAL_ERROR" });
  });
});

describe("reconcileAsaasPayment × webhook real do Asaas", () => {
  it("webhook real chegando DEPOIS (outro providerEventId) não dispara segundo fulfillment", async () => {
    await reconcileAsaasPayment(input, asaasReturning(received()));
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
    const result = await realWebhook();
    expect(result).toMatchObject({ duplicate: false });
    expect(state().paymentEvents.map((e) => e.providerEventId)).toEqual([`manual-reconcile:${EXT}`, "evt_real_asaas_1"]);
    expect(state().payment.status).toBe("PAID");
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
  });

  it("reconciliação DEPOIS do webhook não faz nada: recusa, sem consultar o Asaas e sem gravar", async () => {
    await realWebhook();
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
    const before = structuredClone(state());
    const { asaas, getPayment } = asaasReturning(received());
    await expect(reconcileAsaasPayment(input, { asaas })).rejects.toMatchObject({ code: "PAYMENT_ALREADY_PAID" });
    expect(getPayment).not.toHaveBeenCalled();
    unchanged(before);
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileAsaasPayment — recusas sem gravar nada", () => {
  it.each([
    ["Payment já PAID", { payment: { status: "PAID" } }, "PAYMENT_ALREADY_PAID"],
    ["Payment FAILED", { payment: { status: "FAILED" } }, "PAYMENT_NOT_RECONCILABLE"],
    ["Order fora de PENDING_PAYMENT", { order: { status: "CANCELLED" } }, "ORDER_NOT_PENDING_PAYMENT"],
    ["Payment de outro provider", { payment: { provider: "mock" } }, "NOT_ASAAS"],
    ["Payment sem externalPaymentId", { payment: { externalPaymentId: null } }, "NO_EXTERNAL_PAYMENT"],
  ] as const)("%s", async (_, overrides, code) => {
    seed(overrides as never);
    const before = structuredClone(state());
    const { asaas, getPayment } = asaasReturning(received());
    await expect(reconcileAsaasPayment(input, { asaas })).rejects.toMatchObject({ code });
    expect(getPayment).not.toHaveBeenCalled();
    unchanged(before);
    expect(h.engine.executeFulfillment).not.toHaveBeenCalled();
  });

  it.each([
    ["status não RECEIVED (PENDING)", { status: "PENDING" }, "ASAAS_NOT_RECEIVED"],
    ["status CONFIRMED", { status: "CONFIRMED" }, "ASAAS_NOT_RECEIVED"],
    ["valor diferente", { value: 31.99 }, "ASAAS_VALUE_MISMATCH"],
    ["externalReference diferente", { externalReference: "outro-pedido" }, "ASAAS_REFERENCE_MISMATCH"],
    ["externalReference ausente", { externalReference: null }, "ASAAS_REFERENCE_MISMATCH"],
    ["id diferente", { id: "pay_outro" }, "ASAAS_ID_MISMATCH"],
  ] as const)("Asaas diverge: %s", async (_, change, code) => {
    const before = structuredClone(state());
    await expect(
      reconcileAsaasPayment(input, asaasReturning({ ...received(), ...change } as ReturnType<typeof received>)),
    ).rejects.toMatchObject({ code });
    unchanged(before);
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.engine.executeFulfillment).not.toHaveBeenCalled();
  });
});

describe("reconcileAsaasPayment — clique duplo e concorrência", () => {
  it("clique duplo (sequencial): o segundo é recusado e há um único fulfillment", async () => {
    const first = asaasReturning(received());
    await reconcileAsaasPayment(input, first);
    await expect(reconcileAsaasPayment(input, asaasReturning(received()))).rejects.toMatchObject({ code: "PAYMENT_ALREADY_PAID" });
    expect(state().paymentEvents).toHaveLength(1);
    expect(state().audits).toHaveLength(1);
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
  });

  it("chamadas concorrentes: só uma vence, no máximo um fulfillment", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => reconcileAsaasPayment(input, asaasReturning(received()))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected"))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(PaymentReconcileError);
    expect(state().paymentEvents).toHaveLength(1);
    expect(state().orderEvents).toHaveLength(1);
    expect(state().audits).toHaveLength(1);
    expect(h.engine.executeFulfillment).toHaveBeenCalledTimes(1);
  });

  it("claim perdido dentro da transação (leitura antes do commit do outro): count 0, nada gravado", async () => {
    const pendingView = await h.db.order.findUnique();
    // Outro processo já confirmou; a leitura dentro da transação ainda vê PENDING.
    state().payment.status = "PAID";
    state().order.status = "PAID";
    const before = structuredClone(state());
    h.db.order.findUnique.mockResolvedValueOnce(pendingView).mockResolvedValueOnce(pendingView);
    await expect(reconcileAsaasPayment(input, asaasReturning(received()))).rejects.toMatchObject({ code: "CONCURRENT_RECONCILE" });
    unchanged(before);
    expect(h.engine.executeFulfillment).not.toHaveBeenCalled();
  });

  it("PaymentEvent sintético já existente (P2002) vira CONCURRENT_RECONCILE e desfaz o claim", async () => {
    state().paymentEvents.push({ providerEventId: `manual-reconcile:${EXT}`, paymentId: "payment-1", payload: {} });
    const before = structuredClone(state());
    await expect(reconcileAsaasPayment(input, asaasReturning(received()))).rejects.toMatchObject({ code: "CONCURRENT_RECONCILE" });
    unchanged(before);
    expect(h.engine.executeFulfillment).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/orders/[id]/reconcile-payment (handler)", () => {
  const admin = async () => ({ id: "admin-1" });
  const callWith = (getPayment: () => Promise<unknown>) =>
    handleAdminPaymentReconcile("order-1", admin, (i) =>
      reconcileAsaasPayment(i, { asaas: () => ({ getPayment: getPayment as never }) }),
    );

  it("403 sem admin, sem consultar nada", async () => {
    const reconcile = vi.fn();
    const response = await handleAdminPaymentReconcile("order-1", async () => {
      throw new Error("forbidden");
    }, reconcile);
    expect(response.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("erro do Asaas: 502 e nada gravado", async () => {
    const before = structuredClone(state());
    const response = await callWith(async () => {
      throw new AsaasClientError(500, "ASAAS_HTTP_500");
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "ASAAS_UNAVAILABLE" });
    unchanged(before);
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.engine.executeFulfillment).not.toHaveBeenCalled();
  });

  it("Asaas sem chave neste ambiente: 503 e nada gravado", async () => {
    const before = structuredClone(state());
    const response = await handleAdminPaymentReconcile("order-1", admin, (i) =>
      reconcileAsaasPayment(i, { asaas: () => new AsaasPaymentProvider() }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "ASAAS_NOT_CONFIGURED" });
    unchanged(before);
  });

  it("divergência: 409 com o motivo explicado", async () => {
    const response = await callWith(async () => ({ ...received(), value: 12 }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("ASAAS_VALUE_MISMATCH");
    expect(body.error).toContain("valor");
  });

  it("Payment já PAID: 409 PAYMENT_ALREADY_PAID", async () => {
    seed({ payment: { status: "PAID" }, order: { status: "DELIVERED" } });
    const response = await callWith(async () => received());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PAYMENT_ALREADY_PAID" });
  });

  it("sucesso: 200 com o resultado", async () => {
    const response = await callWith(async () => received());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "RECONCILED", fulfillment: "EXECUTED" } });
  });
});
