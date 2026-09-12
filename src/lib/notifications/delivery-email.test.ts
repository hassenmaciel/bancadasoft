import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  deliveryNotification: {
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  siteSettings: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../prisma", () => ({ prisma: db }));
import { createDeliveryAccess } from "../guest-delivery";
import { deliveryEmailContent, sendDeliveryEmail } from "./delivery-email";

describe("notificação de entrega por e-mail", () => {
  const transport = { send: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "isolated-email-test-secret-with-32-bytes";
    const access = createDeliveryAccess(
      new Date(),
      "delivery-token-for-email-tests-12345",
    );
    db.order.findUnique.mockResolvedValue({
      id: "order-1",
      publicToken: "publictoken",
      status: "DELIVERED",
      deliveryTokenEncrypted: access.encryptedToken,
      deliveryNotifiedAt: null,
      customer: { name: "Cliente", email: "CLIENTE@example.com" },
      items: [{ product: { name: "UnlockTool 6 horas" } }],
      fulfillment: {
        delivery: { username: "private-user", password: "private-password" },
      },
    });
    db.deliveryNotification.create.mockResolvedValue({ id: "notification-1" });
    db.deliveryNotification.updateMany.mockResolvedValue({ count: 1 });
    db.deliveryNotification.update.mockResolvedValue({});
    db.order.update.mockResolvedValue({});
    db.siteSettings.findUnique.mockResolvedValue({
      domain: "www.bancadasoft.com.br",
    });
    db.$transaction.mockImplementation((items: unknown[]) =>
      Promise.all(items),
    );
    transport.send.mockResolvedValue({ messageId: "resend-message-1" });
  });
  it("envia somente após DELIVERED, ao destinatário persistido", async () => {
    await expect(
      sendDeliveryEmail("order-1", {
        apiKey: "test-key",
        from: "BancadaSoft <acesso@example.com>",
        transport,
      }),
    ).resolves.toEqual({ status: "SENT" });
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "cliente@example.com" }),
    );
  });
  it.each(["PENDING_PAYMENT", "PAID", "PROCESSING"])(
    "não envia no estado %s",
    async (status) => {
      db.order.findUnique.mockResolvedValueOnce({
        ...(await db.order.findUnique()),
        status,
      });
      expect(
        await sendDeliveryEmail("order-1", {
          apiKey: "key",
          from: "from@example.com",
          transport,
        }),
      ).toEqual({ status: "SKIPPED" });
      expect(transport.send).not.toHaveBeenCalled();
    },
  );
  it("não inclui credenciais e inclui o link seguro", () => {
    const content = deliveryEmailContent({
      customerName: "Cliente",
      orderNumber: "PUBLIC",
      productName: "UnlockTool",
      recipientEmail: "cliente@example.com",
      secureUrl: "https://www.bancadasoft.com.br/acompanhar/order#token=safe",
    });
    expect(`${content.html}${content.text}`).toContain(
      "/acompanhar/order#token=",
    );
    expect(`${content.html}${content.text}`).not.toContain("private-user");
    expect(`${content.html}${content.text}`).not.toContain("private-password");
  });
  it("falha do Resend registra FAILED sem alterar o pedido entregue", async () => {
    transport.send.mockRejectedValueOnce(new Error("provider details"));
    expect(
      await sendDeliveryEmail("order-1", {
        apiKey: "key",
        from: "from@example.com",
        transport,
      }),
    ).toEqual({ status: "FAILED" });
    expect(db.deliveryNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "EMAIL_DELIVERY_FAILED",
        }),
      }),
    );
    expect(db.order.update).not.toHaveBeenCalled();
  });
  it("configuração ausente não quebra a entrega", async () => {
    expect(
      await sendDeliveryEmail("order-1", { apiKey: "", from: "", transport }),
    ).toEqual({ status: "NOT_CONFIGURED" });
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("callback lógico duplicado não envia novamente", async () => {
    db.deliveryNotification.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "6.19.0",
      }),
    );
    expect(
      await sendDeliveryEmail("order-1", {
        apiKey: "key",
        from: "from@example.com",
        transport,
      }),
    ).toEqual({ status: "DUPLICATE" });
    expect(transport.send).not.toHaveBeenCalled();
  });
});
