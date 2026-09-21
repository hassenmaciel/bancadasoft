import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  providerOrder: {
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  providerCallbackEvent: { create: vi.fn(), update: vi.fn() },
  fulfillment: { update: vi.fn() },
  order: { update: vi.fn() },
  $transaction: vi.fn(),
}));
const sendDeliveryEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/notifications/delivery-email", () => ({ sendDeliveryEmail }));

import { POST } from "@/app/api/internal/providers/heartunlocks/callback/route";
import { processHeartUnlocksCallback } from "./heartunlocks-callback";

const SECRET = "isolated-internal-secret-for-callback-tests";
const b64 = (text: string) => Buffer.from(text).toString("base64");
const REVIEW_NOTE =
  "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir a licença no painel do fornecedor.";

const licenseProduct = {
  name: "UnlockTool — Licença 3 meses",
  type: "LICENSE",
  brand: { name: "UnlockTool" },
};
const rentalProduct = { name: "UnlockTool 6 horas", type: "RENTAL", brand: { name: "UnlockTool" } };
const samsungLicense = { name: "SamsungTool — KG Bypass", type: "LICENSE", brand: { name: "SamsungTool" } };
const phoenix = { name: "Phoenix Service Tool", type: "TOOL", brand: { name: "Phoenix ServiceTool" } };
const legacyProduct = { name: "Produto legado" };

function state(product: unknown, expectedDeliveryType = "LICENSE", overrides: Record<string, unknown> = {}) {
  db.providerOrder.findUniqueOrThrow.mockResolvedValue({
    id: "po-1",
    orderId: "order-1",
    fulfillmentId: "ful-1",
    status: "PROCESSING",
    fulfillment: { delivery: null },
    order: { items: [{ product }] },
    providerProduct: { expectedDeliveryType },
    ...overrides,
  });
}

let counter = 0;
async function callback(status: string, replay?: string) {
  counter += 1;
  const response = await POST(
    new Request("http://localhost/api/internal/providers/heartunlocks/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": SECRET },
      body: JSON.stringify({
        reference_id: "po-1",
        order_id: `ext-${counter}`,
        status,
        ...(replay === undefined ? {} : { replay }),
      }),
    }),
  );
  return response.json();
}

const orderEvents = () =>
  db.order.update.mock.calls.flatMap(
    (call) => (call[0].data.events?.create ?? []) as Array<{ status: string; note: string }>,
  );
const failedByReplay = () =>
  db.providerOrder.update.mock.calls.some((call) => call[0].data.lastError === "REPLAY_REQUIRES_ACTION");

describe("callback HeartUnlocks: success sem retorno textual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BANCADASOFT_INTERNAL_SECRET = SECRET;
    db.$transaction.mockImplementation(async (fn) => fn(db));
    db.providerOrder.findFirst.mockResolvedValue({ id: "po-1" });
    db.providerCallbackEvent.create.mockResolvedValue({});
    sendDeliveryEmail.mockResolvedValue({ status: "SENT" });
    state(licenseProduct);
  });

  describe("licença UnlockTool sem replay utilizável", () => {
    it.each([
      ["ausente", undefined],
      ['vazio ("")', ""],
      ["só espaços", b64("   ")],
      ["ilegível (bytes de controle)", Buffer.from([0, 1, 2, 3]).toString("base64")],
      ["ilegível (não é base64)", "@@@ não é base64 @@@"],
      ["só quebra HTML (parser não gera entrega)", b64("<br>")],
    ])("replay %s: COMPLETED/FULFILLED/DELIVERED, revisão manual e e-mail 1 vez", async (_label, replay) => {
      const result = await callback("success", replay);

      expect(result).toMatchObject({ received: true, matched: true, delivered: true });
      expect(db.providerOrder.update).toHaveBeenCalledWith({
        where: { id: "po-1" },
        data: expect.objectContaining({ status: "COMPLETED", lastError: null }),
      });
      const fulfillment = db.fulfillment.update.mock.calls[0][0];
      expect(fulfillment.data.status).toBe("FULFILLED");
      expect(fulfillment.data.delivery).toEqual({
        kind: "provider-delivery",
        deliveryType: "LICENSE",
        title: "UnlockTool — Licença 3 meses",
        instructions: expect.any(String),
      });
      expect("credential" in fulfillment.data.delivery).toBe(false);
      expect("deliveryFields" in fulfillment.data.delivery).toBe(false);
      expect(db.order.update.mock.calls[0][0].data.status).toBe("DELIVERED");
      expect(orderEvents()).toEqual([
        { status: "FULFILLED", note: "Liberação concluída pelo fornecedor." },
        { status: "DELIVERED", note: "Entrega disponibilizada ao cliente." },
        { status: "DELIVERED", note: REVIEW_NOTE },
      ]);
      expect(failedByReplay()).toBe(false);
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
      expect(sendDeliveryEmail).toHaveBeenCalledWith("order-1");
    });
  });

  describe("licença com retorno utilizável: comportamento anterior", () => {
    it('replay "Success": entrega LICENSE com o retorno, sem evento de revisão manual', async () => {
      await callback("success", b64("Success"));
      const delivery = db.fulfillment.update.mock.calls[0][0].data.delivery;
      expect(delivery).toMatchObject({
        deliveryType: "LICENSE",
        credential: "Success",
        deliveryFields: [{ key: "license", label: "Licença", value: "Success", sensitive: true }],
      });
      expect(orderEvents().map((event) => event.note)).toEqual([
        "Liberação concluída pelo fornecedor.",
        "Entrega disponibilizada ao cliente.",
      ]);
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
    });
    it("replay com vários pares (dados fictícios): MULTI_FIELD, sem revisão manual", async () => {
      const line =
        "UnlockTool: 12 Months<br>Username: usuario_teste<br>Email: teste@exemplo.com<br>Order date: 14/07/2026 02:51:49<br>Status: Activated Successfully.";
      await callback("success", b64(line));
      const delivery = db.fulfillment.update.mock.calls[0][0].data.delivery;
      expect(delivery.deliveryType).toBe("MULTI_FIELD");
      expect(delivery.deliveryFields.map((field: { key: string }) => field.key)).toEqual([
        "unlocktool",
        "username",
        "email",
        "order_date",
        "status",
      ]);
      expect(orderEvents().map((event) => event.note)).not.toContain(REVIEW_NOTE);
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
    });
  });

  describe("tudo o que não é licença UnlockTool continua igual", () => {
    it.each([
      ["aluguel unlocktool-6h (UnlockTool + RENTAL, entrega CREDENTIALS)", rentalProduct, "CREDENTIALS"],
      ["SamsungTool (LICENSE de outra marca)", samsungLicense, "LICENSE"],
      ["Phoenix", phoenix, "CREDENTIALS"],
      ["produto sem marca/tipo (fixture legado)", legacyProduct, "LICENSE"],
      ["licença UnlockTool ligada a ProviderProduct de credencial", licenseProduct, "CREDENTIALS"],
    ])("%s + success sem replay: FAILED com REPLAY_REQUIRES_ACTION, sem e-mail", async (_label, product, expected) => {
      state(product, expected);
      const result = await callback("success");

      expect(result).toMatchObject({ received: true, matched: true, delivered: false });
      expect(db.providerOrder.update).toHaveBeenCalledWith({
        where: { id: "po-1" },
        data: expect.objectContaining({ status: "FAILED", lastError: "REPLAY_REQUIRES_ACTION" }),
      });
      expect(db.fulfillment.update.mock.calls[0][0].data).toEqual({ status: "FAILED" });
      expect(db.order.update.mock.calls[0][0].data.status).toBe("FAILED");
      expect(orderEvents()).toEqual([
        { status: "FAILED", note: "Entrega recebida requer análise administrativa." },
      ]);
      expect(sendDeliveryEmail).not.toHaveBeenCalled();
    });
    it("outro produto com replay ilegível que gera entrega nula continua lançando REPLAY_REQUIRES_ACTION", async () => {
      state(samsungLicense, "LICENSE");
      await expect(
        processHeartUnlocksCallback({
          reference_id: "po-1",
          order_id: "ext-x",
          status: "success",
          replay: b64("<br>"),
        }),
      ).rejects.toThrow("REPLAY_REQUIRES_ACTION");
      expect(db.providerOrder.update).not.toHaveBeenCalled();
    });
    it("aluguel com credenciais válidas continua entregando", async () => {
      state(rentalProduct, "CREDENTIALS");
      await callback("success", b64("Username: u1\nPassword: p1"));
      expect(db.fulfillment.update.mock.calls[0][0].data.delivery).toMatchObject({
        deliveryType: "CREDENTIALS",
        username: "u1",
      });
      expect(orderEvents().map((event) => event.note)).not.toContain(REVIEW_NOTE);
    });
  });

  describe("status diferente de success", () => {
    it.each(["failed", "rejected", "REJECTED"])("licença + %s: continua FAILED (PROVIDER_REJECTED)", async (status) => {
      const result = await callback(status);
      expect(result).toMatchObject({ delivered: false });
      expect(db.providerOrder.update).toHaveBeenCalledWith({
        where: { id: "po-1" },
        data: expect.objectContaining({ status: "FAILED", lastError: "PROVIDER_REJECTED" }),
      });
      expect(orderEvents()).toEqual([{ status: "FAILED", note: "Fornecedor rejeitou o processamento." }]);
      expect(sendDeliveryEmail).not.toHaveBeenCalled();
    });
    it("licença + status intermediário (processing): não muda estado", async () => {
      await callback("processing");
      expect(db.providerOrder.update).not.toHaveBeenCalled();
      expect(db.order.update).not.toHaveBeenCalled();
      expect(sendDeliveryEmail).not.toHaveBeenCalled();
    });
  });

  describe("idempotência", () => {
    it("callback duplicado (mesma chave de evento, P2002): sem escrita, sem evento e sem e-mail", async () => {
      db.providerCallbackEvent.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
      );
      const result = await callback("success");
      expect(result).toMatchObject({ received: true, matched: true, duplicate: true });
      expect(db.providerOrder.update).not.toHaveBeenCalled();
      expect(db.fulfillment.update).not.toHaveBeenCalled();
      expect(db.order.update).not.toHaveBeenCalled();
      expect(sendDeliveryEmail).not.toHaveBeenCalled();
    });
    it("segundo callback depois de concluído (chave diferente): estado final, sem novos eventos nem e-mail", async () => {
      await callback("success");
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
      const eventsAfterFirst = orderEvents().length;
      db.providerOrder.update.mockClear();
      state(licenseProduct, "LICENSE", { status: "COMPLETED", fulfillment: { delivery: { kind: "provider-delivery" } } });
      const second = await callback("success");
      expect(second).toMatchObject({ final: true });
      expect(second.delivered).toBeUndefined();
      expect(db.providerOrder.update).not.toHaveBeenCalled();
      expect(orderEvents().length).toBe(eventsAfterFirst);
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
    });
    it("licença marcada FAILED por callback anterior com outra chave: novo success sem texto conclui a entrega", async () => {
      state(licenseProduct, "LICENSE", { status: "FAILED" });
      const result = await callback("success");
      expect(result).toMatchObject({ delivered: true });
      expect(sendDeliveryEmail).toHaveBeenCalledTimes(1);
    });
  });
});
