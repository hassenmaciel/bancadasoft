import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const external = vi.hoisted(() => ({
  resolveProviderAdapter: vi.fn(),
  sendDeliveryEmail: vi.fn(),
  resendDeliveryEmail: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/providers/registry", () => ({
  resolveProviderAdapter: external.resolveProviderAdapter,
}));
vi.mock("@/lib/notifications/delivery-email", () => ({
  sendDeliveryEmail: external.sendDeliveryEmail,
  resendDeliveryEmail: external.resendDeliveryEmail,
}));

import { ManualDeliveryError, registerManualDelivery } from "./admin-manual-delivery";
import { MANUAL_DELIVERY_PAYLOAD } from "./manual-delivery-rules";
import { customerDelivery } from "./customer-delivery";
import { customerVisibleEvents } from "./dto";

type FakeOrder = {
  status: string;
  payment: { status: string } | null;
  fulfillment: { id: string; status: string; delivery: unknown; provider?: string } | null;
  providerOrders: Array<{ status: string }>;
};
type FakeState = {
  order: FakeOrder | null;
  events: Array<{ orderId: string; status: string; note: string }>;
  audits: Array<Record<string, unknown>>;
};

const REASON = "Acesso comprado no painel do fornecedor e entregue pelo WhatsApp.";
const input = { orderId: "order-1", adminId: "admin-1", reason: REASON };

// Pedido de referência (#N1G9W9IQ): Order/Fulfillment/ProviderOrder FAILED,
// pagamento PAID, sem Delivery.
const rejectedOrder = (): FakeOrder => ({
  status: "FAILED",
  payment: { status: "PAID" },
  fulfillment: { id: "ful-1", status: "FAILED", delivery: null },
  providerOrders: [{ status: "FAILED" }],
});

// Banco em memória com a semântica que importa aqui: findUnique devolve uma
// CÓPIA (snapshot do momento da leitura) e updateMany só altera quando o
// where ainda bate com o estado ATUAL — igual ao claim condicional do Postgres.
function fakeDb(order: FakeOrder | null) {
  const state: FakeState = { order, events: [], audits: [] };
  const tx = {
    order: {
      findUnique: vi.fn(async () =>
        state.order ? structuredClone(state.order) : null,
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (!state.order || state.order.status !== where.status) return { count: 0 };
        state.order.status = data.status;
        return { count: 1 };
      }),
    },
    fulfillment: {
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status: string }; data: { status: string; delivery: unknown } }) => {
          const current = state.order?.fulfillment;
          if (!current || current.id !== where.id || current.status !== where.status || current.delivery != null)
            return { count: 0 };
          current.status = data.status;
          current.delivery = data.delivery;
          return { count: 1 };
        },
      ),
      create: vi.fn(async ({ data }: { data: { status: string; delivery: unknown; provider: string } }) => {
        state.order!.fulfillment = { id: "ful-new", ...data };
        return state.order!.fulfillment;
      }),
    },
    providerOrder: { update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), create: vi.fn() },
    orderEvent: {
      createMany: vi.fn(async ({ data }: { data: FakeState["events"] }) => {
        state.events.push(...data);
        return { count: data.length };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audits.push(data);
        return data;
      }),
    },
  };
  const client = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return {
    state,
    tx,
    client: client as unknown as NonNullable<Parameters<typeof registerManualDelivery>[1]>,
  };
}

const fetchSpy = vi.fn();
beforeEach(() => {
  external.resolveProviderAdapter.mockReset();
  external.sendDeliveryEmail.mockReset();
  external.resendDeliveryEmail.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(ManualDeliveryError);
  expect((error as ManualDeliveryError).code).toBe(code);
}

function expectNothingWritten(db: ReturnType<typeof fakeDb>) {
  expect(db.tx.order.updateMany).not.toHaveBeenCalled();
  expect(db.tx.fulfillment.updateMany).not.toHaveBeenCalled();
  expect(db.tx.fulfillment.create).not.toHaveBeenCalled();
  expect(db.state.events).toEqual([]);
  expect(db.state.audits).toEqual([]);
}

describe("registerManualDelivery — sucesso no pedido de referência (rejeitado pelo fornecedor)", () => {
  it("Order → DELIVERED, Fulfillment → FULFILLED com a Delivery TEXT fixa, eventos e auditoria na mesma transação", async () => {
    const db = fakeDb(rejectedOrder());
    await expect(registerManualDelivery(input, db.client)).resolves.toEqual({ status: "DELIVERED" });

    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    expect(db.state.order?.status).toBe("DELIVERED");
    expect(db.state.order?.fulfillment?.status).toBe("FULFILLED");
    expect(db.state.order?.fulfillment?.delivery).toEqual(MANUAL_DELIVERY_PAYLOAD);
    expect(db.tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: "order-1", status: "FAILED" },
      data: { status: "DELIVERED" },
    });
    expect(db.tx.fulfillment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ful-1", status: "FAILED", delivery: { equals: Prisma.DbNull } },
      }),
    );
    expect(db.state.audits).toEqual([
      {
        actorUserId: "admin-1",
        action: "ORDER_MANUAL_DELIVERY",
        entityType: "Order",
        entityId: "order-1",
        metadata: { orderId: "order-1", reason: REASON },
      },
    ]);
  });

  it("não altera o ProviderOrder, não chama fornecedor e não envia e-mail", async () => {
    const db = fakeDb(rejectedOrder());
    await registerManualDelivery(input, db.client);
    expect(db.state.order?.providerOrders).toEqual([{ status: "FAILED" }]);
    for (const fn of Object.values(db.tx.providerOrder)) expect(fn).not.toHaveBeenCalled();
    expect(external.resolveProviderAdapter).not.toHaveBeenCalled();
    expect(external.sendDeliveryEmail).not.toHaveBeenCalled();
    expect(external.resendDeliveryEmail).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a Delivery não contém credencial e é aceita por customerDelivery como TEXT", async () => {
    const db = fakeDb(rejectedOrder());
    await registerManualDelivery(input, db.client);
    const delivery = db.state.order?.fulfillment?.delivery as Record<string, unknown>;
    expect(Object.keys(delivery).sort()).toEqual(["deliveryType", "instructions", "title"]);
    for (const key of ["username", "password", "credential", "deliveryFields", "login", "senha"])
      expect(delivery).not.toHaveProperty(key);
    expect(JSON.stringify(delivery)).not.toContain(REASON);
    expect(customerDelivery(delivery)).toEqual({
      deliveryType: "TEXT",
      title: "Entrega manual",
      instructions: "Seu acesso foi entregue pelo suporte da BancadaSoft.",
    });
  });

  it("evento interno guarda o motivo (UTF-8) e fica escondido do cliente; o evento público não expõe o motivo", async () => {
    const db = fakeDb(rejectedOrder());
    await registerManualDelivery(input, db.client);
    expect(db.state.events).toEqual([
      { orderId: "order-1", status: "DELIVERED", note: "Entrega registrada pelo suporte." },
      {
        orderId: "order-1",
        status: "DELIVERED",
        note: `REVISÃO MANUAL: entrega manual registrada pelo Admin. Motivo: ${REASON}`,
      },
    ]);
    const visible = customerVisibleEvents(
      db.state.events.map((event) => ({ ...event, createdAt: new Date() })),
    );
    expect(visible.map((event) => event.note)).toEqual(["Entrega registrada pelo suporte."]);
  });

  it("pago sem Fulfillment: cria o Fulfillment FULFILLED (provider manual) com a mesma Delivery", async () => {
    const db = fakeDb({ status: "FAILED", payment: { status: "PAID" }, fulfillment: null, providerOrders: [] });
    await registerManualDelivery(input, db.client);
    expect(db.tx.fulfillment.create).toHaveBeenCalledWith({
      data: { orderId: "order-1", provider: "manual", status: "FULFILLED", delivery: MANUAL_DELIVERY_PAYLOAD },
    });
    expect(db.state.order?.status).toBe("DELIVERED");
  });

  it("ProviderOrder QUEUED (nunca enviado) não bloqueia", async () => {
    const db = fakeDb({ ...rejectedOrder(), status: "PAID", providerOrders: [{ status: "QUEUED" }] });
    await expect(registerManualDelivery(input, db.client)).resolves.toEqual({ status: "DELIVERED" });
  });
});

describe("registerManualDelivery — cada pré-condição recusa sem gravar nada", () => {
  const cases: Array<[string, FakeOrder]> = [
    ["PAYMENT_NOT_PAID", { ...rejectedOrder(), payment: { status: "PENDING" } }],
    ["PAYMENT_NOT_PAID", { ...rejectedOrder(), payment: null }],
    ["ORDER_ALREADY_DELIVERED", { ...rejectedOrder(), status: "DELIVERED" }],
    ["ORDER_CANCELLED", { ...rejectedOrder(), status: "CANCELLED" }],
    ["PROVIDER_ORDER_PROCESSING", { ...rejectedOrder(), status: "PROCESSING", providerOrders: [{ status: "PROCESSING" }] }],
    ["PROVIDER_ORDER_COMPLETED", { ...rejectedOrder(), providerOrders: [{ status: "COMPLETED" }] }],
    [
      "DELIVERY_ALREADY_EXISTS",
      { ...rejectedOrder(), fulfillment: { id: "ful-1", status: "FAILED", delivery: { deliveryType: "TEXT", instructions: "x" } } },
    ],
  ];
  it.each(cases)("%s", async (code, order) => {
    const db = fakeDb(order);
    await expectCode(registerManualDelivery(input, db.client), code);
    expectNothingWritten(db);
  });

  it("ORDER_NOT_FOUND", async () => {
    const db = fakeDb(null);
    await expectCode(registerManualDelivery(input, db.client), "ORDER_NOT_FOUND");
    expectNothingWritten(db);
  });
});

describe("registerManualDelivery — concorrência", () => {
  it("duas chamadas simultâneas geram no máximo uma entrega", async () => {
    const db = fakeDb(rejectedOrder());
    const results = await Promise.allSettled([
      registerManualDelivery(input, db.client),
      registerManualDelivery({ ...input, adminId: "admin-2" }, db.client),
    ]);
    // As duas leram o mesmo snapshot (FAILED) antes de qualquer escrita.
    expect(db.tx.order.findUnique).toHaveBeenCalledTimes(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "CONCURRENT_MANUAL_DELIVERY",
    });
    expect(db.tx.fulfillment.updateMany).toHaveBeenCalledTimes(1);
    expect(db.state.events).toHaveLength(2);
    expect(db.state.audits).toHaveLength(1);
  });

  it("Fulfillment mudou depois da leitura (claim do Fulfillment falha) → CONCURRENT_MANUAL_DELIVERY", async () => {
    const db = fakeDb(rejectedOrder());
    db.tx.fulfillment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expectCode(registerManualDelivery(input, db.client), "CONCURRENT_MANUAL_DELIVERY");
    expect(db.state.events).toEqual([]);
    expect(db.state.audits).toEqual([]);
  });

  it("Fulfillment criado em paralelo (P2002 em orderId) → CONCURRENT_MANUAL_DELIVERY", async () => {
    const db = fakeDb({ status: "FAILED", payment: { status: "PAID" }, fulfillment: null, providerOrders: [] });
    db.tx.fulfillment.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["orderId"] },
      }),
    );
    await expectCode(registerManualDelivery(input, db.client), "CONCURRENT_MANUAL_DELIVERY");
  });
});
