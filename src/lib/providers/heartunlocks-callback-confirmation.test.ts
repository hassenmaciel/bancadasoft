import { beforeEach, describe, expect, it, vi } from "vitest";

// Prova de entrega dos créditos (confirmação sem texto) e baseline das demais
// ramificações do callback: o objeto de entrega gravado é fixado com toEqual.
const db = vi.hoisted(() => ({
  providerOrder: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  providerCallbackEvent: { create: vi.fn(), update: vi.fn() },
  fulfillment: { update: vi.fn() },
  order: { update: vi.fn() },
  $transaction: vi.fn(),
}));
const sendDeliveryEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/notifications/delivery-email", () => ({ sendDeliveryEmail }));

import { processHeartUnlocksCallback } from "./heartunlocks-callback";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const phoenixCredits = { name: "Phoenix Service Tool", type: "CREDIT", acceptsSuccessWithoutText: true, brand: { name: "Phoenix ServiceTool" } };
const licenseProduct = { name: "UnlockTool — Licença 3 meses", type: "LICENSE", brand: { name: "UnlockTool" } };
const rentalProduct = { name: "UnlockTool 6 horas", type: "RENTAL", brand: { name: "UnlockTool" } };
const schema = [
  { key: "quantity", type: "quantity", label: "Quantity", position: 0, required: true, sensitive: false, customerVisible: false, providerFieldName: "Quantity" },
  { key: "email", type: "email", label: "Email", position: 1, required: true, sensitive: false, customerVisible: true, providerFieldName: "Email" },
];
const CREDITS_NOTE =
  "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir os créditos no painel do fornecedor.";

function state(item: Record<string, unknown>, expectedDeliveryType: string) {
  db.providerOrder.findUniqueOrThrow.mockResolvedValue({
    id: "po-1",
    orderId: "order-1",
    fulfillmentId: "ful-1",
    status: "PROCESSING",
    fulfillment: { delivery: null },
    order: { items: [item] },
    providerProduct: { expectedDeliveryType },
  });
}
let counter = 0;
const callback = (status: string, replay?: string) =>
  processHeartUnlocksCallback({ reference_id: "po-1", order_id: `ext-${++counter}`, status, ...(replay === undefined ? {} : { replay }) });
const delivery = () => db.fulfillment.update.mock.calls[0][0].data.delivery;
const notes = () =>
  db.order.update.mock.calls.flatMap((call) => (call[0].data.events?.create ?? []) as Array<{ note: string }>).map((event) => event.note);

describe("callback HeartUnlocks: prova de entrega dos créditos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn) => fn(db));
    db.providerOrder.findFirst.mockResolvedValue({ id: "po-1" });
    db.providerCallbackEvent.create.mockResolvedValue({});
    sendDeliveryEmail.mockResolvedValue({ status: "SENT" });
  });

  describe("baseline (ramificações que não mudam)", () => {
    it("Phoenix sem providerFields: mesmo objeto de antes (fora o marcador) e mesma nota", async () => {
      state({ quantity: 5, product: phoenixCredits }, "MULTI_FIELD");
      await callback("success");
      const { confirmation: _marker, ...rest } = delivery();
      expect(rest).toEqual({
        kind: "provider-delivery",
        deliveryType: "TEXT",
        title: "Phoenix Service Tool",
        instructions: "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.",
      });
      expect(notes()).toContain(CREDITS_NOTE);
    });
    it("Phoenix com retorno textual: entrega do fornecedor idêntica, sem marcador e sem nota", async () => {
      state({ quantity: 5, product: phoenixCredits, providerFields: { Email: "teste@teste.com", Quantity: 5 }, providerProduct: { fieldSchema: schema } }, "MULTI_FIELD");
      await callback("success", b64("Credits added: 5"));
      expect(delivery()).toEqual({
        kind: "provider-delivery",
        title: "Phoenix Service Tool",
        deliveryType: "TEXT",
        deliveryFields: [{ key: "credits_added", label: "Credits added", value: "5", sensitive: false }],
        instructions: "Use os dados entregues somente nas condições do produto contratado.",
      });
      expect(notes()).not.toContain(CREDITS_NOTE);
    });
    it("licença UnlockTool sem texto: entrega de licença idêntica, sem marcador", async () => {
      state({ quantity: 1, product: { ...licenseProduct, acceptsSuccessWithoutText: true }, providerFields: { Username: "tecnico01" } }, "LICENSE");
      await callback("success");
      expect(delivery()).toEqual({
        kind: "provider-delivery",
        deliveryType: "LICENSE",
        title: "UnlockTool — Licença 3 meses",
        instructions: "A ativação foi confirmada pelo fornecedor, sem retorno textual.",
      });
    });
    it("aluguel com credenciais: entrega idêntica, sem marcador", async () => {
      state({ quantity: 1, product: rentalProduct }, "CREDENTIALS");
      await callback("success", b64("Username: u1\nPassword: p1"));
      expect(delivery()).toEqual({
        kind: "credentials",
        title: "UnlockTool 6 horas",
        deliveryType: "CREDENTIALS",
        username: "u1",
        password: "p1",
        deliveryFields: [
          { key: "username", label: "Username", value: "u1", sensitive: false },
          { key: "password", label: "Password", value: "p1", sensitive: true },
        ],
        instructions: "Use os dados entregues somente nas condições do produto contratado.",
      });
    });
  });

  describe("casos novos", () => {
    it("select de items[0] traz providerFields e o fieldSchema do eco", async () => {
      state({ quantity: 5, product: phoenixCredits }, "MULTI_FIELD");
      await callback("success");
      const select = db.providerOrder.findUniqueOrThrow.mock.calls[0][0].include.order.select.items.select;
      expect(select).toMatchObject({
        quantity: true,
        providerFields: true,
        providerProduct: { select: { fieldSchema: true } },
        productVariant: { select: { providerProduct: { select: { fieldSchema: true } } } },
      });
    });
    it("Phoenix com providerFields: frase com quantidade e conta, marcador e mesma nota", async () => {
      state({ quantity: 5, product: phoenixCredits, providerFields: { Email: "teste@teste.com", Quantity: 5 }, providerProduct: { fieldSchema: schema } }, "MULTI_FIELD");
      await callback("success");
      expect(delivery()).toEqual({
        kind: "provider-delivery",
        deliveryType: "TEXT",
        title: "Phoenix Service Tool",
        instructions: "O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.",
        confirmation: true,
      });
      expect(notes()).toContain(CREDITS_NOTE);
    });
    it("Phoenix sem providerFields: texto genérico com marcador", async () => {
      state({ quantity: 5, product: phoenixCredits }, "MULTI_FIELD");
      await callback("success");
      expect(delivery().confirmation).toBe(true);
    });
    it("quantidade divergente do enviado: texto genérico", async () => {
      state({ quantity: 5, product: phoenixCredits, providerFields: { Email: "teste@teste.com", Quantity: 4 }, providerProduct: { fieldSchema: schema } }, "MULTI_FIELD");
      await callback("success");
      expect(delivery().instructions).toBe("O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.");
    });
  });
});
