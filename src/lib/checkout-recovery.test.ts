import { describe, expect, it, vi } from "vitest";
import {
  handleCheckoutRecoveryRequest,
  needsGuestCheckoutRecovery,
  parseSavedCheckoutReference,
} from "./checkout-recovery";

const recoveryToken = "isolated-recovery-token-with-32-characters";
const baseOrder = {
  id: "order-existing",
  publicToken: "public-token-existing",
  status: "PENDING_PAYMENT",
  totalCents: 1200,
  createdAt: new Date("2026-09-12T12:00:00Z"),
  items: [
    {
      id: "item-existing",
      unitPriceCents: 1200,
      product: {
        id: "product-existing",
        slug: "unlocktool-6h",
        name: "UnlockTool 6h",
        description: "Produto existente",
        longDescription: null,
        type: "RENTAL",
        deliveryType: "AUTOMATIC",
        deliveryEstimate: "1-60 Minutes",
        duration: "6 horas",
        imageUrl: null,
        priceCents: 1200,
        status: "PUBLISHED",
        available: true,
        category: null,
        brand: null,
      },
    },
  ],
  payment: {
    status: "PENDING",
    amountCents: 1200,
    externalPaymentId: "payment-existing",
    pixCode: "same-pix-payload",
    qrCode: "same-qr-image",
    expiresAt: new Date("2026-09-12T12:15:00Z"),
  },
  fulfillment: null,
  events: [],
};

const request = (token: unknown) =>
  new Request("http://localhost/api/checkout/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deliveryAccessToken: token }),
  });

describe("recovery do checkout guest após reload", () => {
  it("reconhece a referência parcial deixada por falha após o POST externo", () => {
    const saved = JSON.stringify({ deliveryAccessToken: recoveryToken });
    const firstReload = parseSavedCheckoutReference(saved)!;
    const secondReload = parseSavedCheckoutReference(saved)!;
    expect(needsGuestCheckoutRecovery(firstReload)).toBe(true);
    expect(secondReload).toEqual(firstReload);
  });

  it("não reinicia recovery quando id e publicToken já foram persistidos", () => {
    const reference = parseSavedCheckoutReference(
      JSON.stringify({
        id: "order-existing",
        publicToken: "public-token-existing",
        deliveryAccessToken: recoveryToken,
      }),
    )!;
    expect(needsGuestCheckoutRecovery(reference)).toBe(false);
  });

  it("ignora CPF e e-mail eventualmente presentes no storage", () => {
    const reference = parseSavedCheckoutReference(
      JSON.stringify({
        deliveryAccessToken: recoveryToken,
        cpfCnpj: "não-utilizado",
        email: "não-utilizado@example.test",
      }),
    );
    expect(reference).toEqual({ deliveryAccessToken: recoveryToken });
  });

  it.each([
    ["PENDING_PAYMENT", "PENDING", null],
    ["PAID", "PAID", null],
    ["PROCESSING", "PAID", { status: "PROCESSING", delivery: null }],
    ["DELIVERED", "PAID", { status: "FULFILLED", delivery: { credential: "protected" } }],
  ])("restaura estado %s usando a mesma Order", async (orderStatus, paymentStatus, fulfillment) => {
    const recover = vi.fn(async () => ({
      ...baseOrder,
      status: orderStatus,
      payment: { ...baseOrder.payment, status: paymentStatus },
      fulfillment,
    }));
    const response = await handleCheckoutRecoveryRequest(
      request(recoveryToken),
      recover,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      data: {
        id: "order-existing",
        status: orderStatus,
        payment: {
          externalPaymentId: "payment-existing",
          pixPayload: "same-pix-payload",
        },
      },
      deliveryAccessToken: recoveryToken,
    });
    expect(recover).toHaveBeenCalledOnce();
  });

  it("rejeita token inválido antes de consultar pedidos", async () => {
    const recover = vi.fn();
    const response = await handleCheckoutRecoveryRequest(request("curto"), recover);
    expect(response.status).toBe(400);
    expect(recover).not.toHaveBeenCalled();
  });

  it("não revela se CPF ou e-mail possuem pedidos", async () => {
    const recover = vi.fn(async () => null);
    const response = await handleCheckoutRecoveryRequest(
      request(recoveryToken),
      recover,
    );
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toMatch(/cpf|email|payment-existing/i);
  });
  it("nao restaura estado de pagamento sem QR e payload utilizaveis", async () => {
    const recover = vi.fn(async () => ({
      ...baseOrder,
      payment: { ...baseOrder.payment, pixCode: "", qrCode: null },
    }));
    const response = await handleCheckoutRecoveryRequest(request(recoveryToken), recover);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "PIX_INCOMPLETE" });
  });
});
