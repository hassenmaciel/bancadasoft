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

vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { processHeartUnlocksCallback } from "./heartunlocks-callback";

describe("HeartUnlocks callback — entrega automática sanitizada", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn) => fn(db));
    db.providerOrder.findFirst.mockResolvedValue({
      id: "provider-order-sanitized",
    });
    db.providerOrder.findUniqueOrThrow.mockResolvedValue({
      id: "provider-order-sanitized",
      orderId: "order-sanitized",
      fulfillmentId: "fulfillment-sanitized",
      status: "PROCESSING",
      fulfillment: { delivery: null },
      order: { items: [{ product: { name: "UnlockTool 7h" } }] },
      providerProduct: { expectedDeliveryType: "CREDENTIALS" },
    });
  });

  it("callback success cria Delivery e conclui Order sem ação do Admin", async () => {
    const replay = Buffer.from(
      "Username: sanitized-user\nPassword: sanitized-pass",
    ).toString("base64");

    await expect(
      processHeartUnlocksCallback({
        reference_id: "provider-order-sanitized",
        order_id: "external-sanitized",
        status: "success",
        replay,
      }),
    ).resolves.toMatchObject({ delivered: true, orderId: "order-sanitized" });

    expect(db.providerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FULFILLED",
          delivery: expect.objectContaining({
            username: "sanitized-user",
            password: "sanitized-pass",
          }),
        }),
      }),
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DELIVERED" }),
      }),
    );
  });

  it("callback repetido encontra estado final e não cria segunda entrega", async () => {
    db.providerOrder.findUniqueOrThrow.mockResolvedValue({
      id: "provider-order-sanitized",
      orderId: "order-sanitized",
      fulfillmentId: "fulfillment-sanitized",
      status: "COMPLETED",
      fulfillment: { delivery: { kind: "credentials" } },
      order: { items: [{ product: { name: "UnlockTool 7h" } }] },
      providerProduct: { expectedDeliveryType: "CREDENTIALS" },
    });

    await expect(
      processHeartUnlocksCallback({
        reference_id: "provider-order-sanitized",
        order_id: "external-sanitized",
        status: "success",
        replay: Buffer.from("Username: u\nPassword: p").toString("base64"),
      }),
    ).resolves.toMatchObject({ final: true });
    expect(db.providerOrder.update).not.toHaveBeenCalled();
    expect(db.fulfillment.update).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it.each(["success", "rejected"])(
    "callback %s depois da entrega manual (ProviderOrder COMPLETED, Delivery TEXT) não altera nada nem reentrega",
    async (status) => {
      db.providerOrder.findUniqueOrThrow.mockResolvedValue({
        id: "provider-order-sanitized",
        orderId: "order-sanitized",
        fulfillmentId: "fulfillment-sanitized",
        status: "COMPLETED",
        fulfillment: {
          delivery: {
            deliveryType: "TEXT",
            title: "Entrega manual",
            instructions: "Seu acesso foi entregue pelo suporte da BancadaSoft.",
          },
        },
        order: { items: [{ product: { name: "UnlockTool 7h" } }] },
        providerProduct: { expectedDeliveryType: "CREDENTIALS" },
      });

      await expect(
        processHeartUnlocksCallback({
          reference_id: "provider-order-sanitized",
          order_id: "external-sanitized",
          status,
          replay: Buffer.from("Username: u\nPassword: p").toString("base64"),
        }),
      ).resolves.toEqual({ matched: true, duplicate: false, final: true });
      expect(db.providerOrder.update).not.toHaveBeenCalled();
      expect(db.fulfillment.update).not.toHaveBeenCalled();
      expect(db.order.update).not.toHaveBeenCalled();
      expect(db.providerCallbackEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { processedAt: expect.any(Date) } }),
      );
    },
  );

  it("callback com orderId diferente do criado loga o erro e entrega normalmente", async () => {
    db.providerOrder.findFirst.mockResolvedValue({
      id: "provider-order-sanitized",
      externalOrderId: "I26101901-criado",
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await processHeartUnlocksCallback({
      reference_id: "provider-order-sanitized",
      order_id: "H26101902-outro",
      status: "success",
      replay: Buffer.from("Username: u\nPassword: p").toString("base64"),
    });
    expect(result).toMatchObject({ matched: true, delivered: true, orderId: "order-sanitized" });
    expect(result).not.toHaveProperty("orderIdMismatch");
    expect(db.providerCallbackEvent.create).toHaveBeenCalled();
    expect(db.providerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", externalOrderId: "H26101902-outro" }),
      }),
    );
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FULFILLED" }) }),
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DELIVERED" }) }),
    );
    expect(error).toHaveBeenCalledWith(
      "[heartunlocks] callback orderId diverge do pedido criado",
      { referenceId: "provider-order-sanitized" },
    );
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/I26101901|H26101902/);
    error.mockRestore();
  });

  it("callback com o mesmo orderId do criado segue o fluxo normal", async () => {
    db.providerOrder.findFirst.mockResolvedValue({
      id: "provider-order-sanitized",
      externalOrderId: "external-sanitized",
    });

    await expect(
      processHeartUnlocksCallback({
        reference_id: "provider-order-sanitized",
        order_id: "external-sanitized",
        status: "success",
        replay: Buffer.from("Username: u\nPassword: p").toString("base64"),
      }),
    ).resolves.toMatchObject({ delivered: true });
  });
});
