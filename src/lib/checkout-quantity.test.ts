import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), create: vi.fn() },
  product: { findFirst: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  user: { findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  accountBalance: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({ executeFulfillment: vi.fn(), safeErrorInfo: vi.fn() }));
vi.mock("@/lib/guest-delivery", () => ({
  createDeliveryAccess: () => ({ token: "t", tokenHash: "h", encryptedToken: "e", expiresAt: new Date() }),
}));
const createPixPayment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/registry", () => ({
  configuredPaymentProviderCode: () => "mock",
  getPaymentProvider: () => ({ code: "mock", createPixPayment }),
}));

import { createOrder } from "./commerce";
import { handleCheckoutRequest } from "./checkout-route";
import { checkoutErrorMessage } from "./checkout-response";
import {
  allowsQuantity,
  assertCheckoutQuantity,
  CheckoutQuantityError,
  orderTotalCents,
  quantityPriceLabel,
  quantityRange,
} from "./checkout-quantity";

describe("regras de quantidade", () => {
  it("produto sem configuração (catálogo anterior) = 1/1: só aceita 1 e não mostra seletor", () => {
    expect(quantityRange({})).toEqual({ min: 1, max: 1 });
    expect(allowsQuantity({ minQuantity: 1, maxQuantity: 1 })).toBe(false);
    expect(assertCheckoutQuantity({}, undefined)).toBe(1);
    expect(assertCheckoutQuantity({ minQuantity: 1, maxQuantity: 1 }, 1)).toBe(1);
    expect(() => assertCheckoutQuantity({ minQuantity: 1, maxQuantity: 1 }, 2)).toThrow(CheckoutQuantityError);
  });

  it("Phoenix 5..100: seletor ligado, aceita o intervalo e recusa fora dele", () => {
    const phoenix = { minQuantity: 5, maxQuantity: 100 };
    expect(allowsQuantity(phoenix)).toBe(true);
    expect(assertCheckoutQuantity(phoenix, 5)).toBe(5);
    expect(assertCheckoutQuantity(phoenix, 100)).toBe(100);
    for (const invalid of [undefined, 1, 4, 101, 5.5])
      expect(() => assertCheckoutQuantity(phoenix, invalid)).toThrow("CHECKOUT_QUANTITY_INVALID");
  });

  it("seletor também para min 1 / max > 1", () => {
    expect(allowsQuantity({ minQuantity: 1, maxQuantity: 10 })).toBe(true);
  });

  it("configuração incoerente cai no seguro (max nunca abaixo do min)", () => {
    expect(quantityRange({ minQuantity: 5, maxQuantity: 2 })).toEqual({ min: 5, max: 5 });
    expect(quantityRange({ minQuantity: 0, maxQuantity: -3 })).toEqual({ min: 1, max: 1 });
  });

  it("total = unitário × quantidade", () => {
    expect(orderTotalCents(1490, 5)).toBe(7450);
    expect(orderTotalCents(2900, 1)).toBe(2900);
    expect(() => orderTotalCents(1490, 0)).toThrow("INVALID_QUANTITY");
  });

  it('rótulo "N × R$X" só com mais de uma unidade', () => {
    expect(quantityPriceLabel(5, "R$ 14,90")).toBe("5 × R$ 14,90");
    expect(quantityPriceLabel(1, "R$ 29,00")).toBe("R$ 29,00");
    expect(quantityPriceLabel(undefined, "R$ 29,00")).toBe("R$ 29,00");
  });
});

// Conta completa: identidade resolvida sem escrita; order.create é o primeiro
// passo com efeito e é interrompido aqui para inspecionar o que seria gravado.
const account = { id: "u1", name: "Cliente", email: "c@example.test", customerTier: "NORMAL", cpfCnpj: "52998224725", whatsapp: "11999999999", asaasCustomerId: null, active: true };
const product = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  type: "TOOL",
  deliveryType: "MANUAL",
  priceCents: 1490,
  normalPriceCents: null,
  premiumPriceCents: null,
  priceVisibility: "PUBLIC",
  minQuantity: 5,
  maxQuantity: 100,
  providerProducts: [],
  variants: [],
  ...over,
});
const input = { productId: "p1", deliveryAccessToken: "token-with-enough-characters-000000" };

describe("createOrder: quantidade validada no servidor antes do PIX", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.user.findFirst.mockResolvedValue(account);
    db.order.create.mockRejectedValue(new Error("STOP_AFTER_CREATE"));
  });

  it.each([undefined, 1, 4, 101])("quantidade %s fora de 5..100: erro antes de Order/Payment/PIX", async (quantity) => {
    db.product.findFirst.mockResolvedValue(product());
    await expect(createOrder({ ...input, quantity }, "u1")).rejects.toBeInstanceOf(CheckoutQuantityError);
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("5 créditos: Order/Payment com total 5 × 1490 e item com quantity 5", async () => {
    db.product.findFirst.mockResolvedValue(product());
    await expect(createOrder({ ...input, quantity: 5 }, "u1")).rejects.toThrow("STOP_AFTER_CREATE");
    const data = db.order.create.mock.calls[0][0].data;
    expect(data.totalCents).toBe(7450);
    expect(data.items.create).toMatchObject({ unitPriceCents: 1490, quantity: 5 });
    expect(data.payment.create.amountCents).toBe(7450);
  });

  it("produto do catálogo anterior (1/1) sem quantity: igual a antes (total = preço)", async () => {
    db.product.findFirst.mockResolvedValue(product({ minQuantity: 1, maxQuantity: 1, priceCents: 2900 }));
    await expect(createOrder(input, "u1")).rejects.toThrow("STOP_AFTER_CREATE");
    const data = db.order.create.mock.calls[0][0].data;
    expect(data.totalCents).toBe(2900);
    expect(data.items.create).toMatchObject({ unitPriceCents: 2900, quantity: 1 });
    expect(data.payment.create.amountCents).toBe(2900);
  });

  it("produto 1/1 recusa quantity 2 (ninguém compra 2 aluguéis por um só PIX)", async () => {
    db.product.findFirst.mockResolvedValue(product({ minQuantity: 1, maxQuantity: 1 }));
    await expect(createOrder({ ...input, quantity: 2 }, "u1")).rejects.toBeInstanceOf(CheckoutQuantityError);
    expect(db.order.create).not.toHaveBeenCalled();
  });
});

describe("rota de checkout", () => {
  const request = (body: Record<string, unknown>) =>
    new Request("https://test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, deliveryAccessToken: "isolated-delivery-token-with-32-characters", ...body }),
    });

  it("CheckoutQuantityError vira 400 INVALID_QUANTITY com o intervalo na mensagem", async () => {
    const response = await handleCheckoutRequest(request({ quantity: 3 }), async () => {
      throw new CheckoutQuantityError(5, 100);
    });
    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({ ok: false, code: "INVALID_QUANTITY", error: "Quantidade inválida: escolha de 5 a 100." });
    expect(checkoutErrorMessage(400, payload)).toBe("Quantidade inválida: escolha de 5 a 100.");
  });

  it("quantity chega ao createOrder já como inteiro; fora de 1..1000 nem chega", async () => {
    const create = vi.fn(async () => undefined);
    await handleCheckoutRequest(request({ quantity: "5" }), create);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5 }));
    create.mockClear();
    const response = await handleCheckoutRequest(request({ quantity: 0 }), create);
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
