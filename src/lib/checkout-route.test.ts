import { describe, expect, it, vi } from "vitest";
import { handleCheckoutRequest } from "./checkout-route";
import { AsaasClientError } from "./payments/asaas-client";

const validInput = {
  productId: "product-test",
  name: "Cliente Teste",
  email: "cliente@example.test",
  whatsapp: "11999999999",
  cpfCnpj: "52998224725",
  deliveryAccessToken: "isolated-delivery-token-with-32-characters",
};

const order = {
  id: "order-test",
  publicToken: "public-test",
  status: "PENDING_PAYMENT",
  totalCents: 1200,
  createdAt: new Date("2026-09-12T12:00:00Z"),
  items: [
    {
      id: "item-test",
      unitPriceCents: 1200,
      product: {
        id: "product-test",
        slug: "produto-test",
        name: "Produto Teste",
        description: "Descrição",
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
    externalPaymentId: "payment-test",
    pixCode: "pix-test",
    qrCode: "qr-test",
    expiresAt: new Date("2026-09-12T12:15:00Z"),
  },
  fulfillment: null,
  events: [],
};

const request = (body: unknown) =>
  new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("contrato HTTP do checkout", () => {
  it("retorna sucesso em JSON com o DTO atual", async () => {
    const create = vi.fn(async () => ({
      order,
      deliveryAccessToken: validInput.deliveryAccessToken,
    }));
    const response = await handleCheckoutRequest(request(validInput), create);
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { id: "order-test", items: [{ id: "item-test" }] },
    });
  });

  it("retorna erro 400 em JSON para body inválido", async () => {
    const create = vi.fn();
    const response = await handleCheckoutRequest(request({}), create);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Dados de checkout inválidos.",
      code: "INVALID_CHECKOUT",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("retorna erro 400 em JSON quando o body não é JSON", async () => {
    const malformed = new Request("http://localhost/api/checkout", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    });
    const response = await handleCheckoutRequest(malformed, vi.fn());
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "INVALID_CHECKOUT",
    });
  });

  it("converte falha do Asaas em erro 500 JSON sem vazar detalhes", async () => {
    const log = vi.fn();
    const create = vi.fn(async () => {
      throw new AsaasClientError(400, "ASAAS_HTTP_400");
    });
    const response = await handleCheckoutRequest(request(validInput), create, log);
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: false,
      error: "Não foi possível gerar o PIX agora. Tente novamente em instantes.",
      code: "CHECKOUT_UNAVAILABLE",
    });
    expect(JSON.stringify(payload)).not.toContain("ASAAS_HTTP_400");
    expect(log).toHaveBeenCalledWith(
      "[checkout] Falha ao gerar PIX.",
      expect.objectContaining({ code: "ASAAS_HTTP_400", status: 400 }),
    );
  });

  it("retorna JSON consistente quando o produto não está disponível", async () => {
    const response = await handleCheckoutRequest(
      request(validInput),
      vi.fn(async () => undefined),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "PRODUCT_UNAVAILABLE",
    });
  });
});
