import { beforeEach, describe, expect, it, vi } from "vitest";
import { topupProviderProduct } from "./testing/topup-fixtures";

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), create: vi.fn() },
  product: { findFirst: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  user: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  accountBalance: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({ executeFulfillment: vi.fn(), safeErrorInfo: () => ({}) }));
vi.mock("@/lib/guest-delivery", () => ({
  createDeliveryAccess: () => ({ token: "t", tokenHash: "h", encryptedToken: "e", expiresAt: new Date() }),
}));
const createPixPayment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/registry", () => ({
  configuredPaymentProviderCode: () => "mock",
  getPaymentProvider: () => ({ code: "mock", createPixPayment }),
}));

import { createOrder } from "./commerce";
import { assertCheckoutPrice, topupCreditCents, type CustomerTierValue } from "./commercial-pricing";
import { productDto } from "./dto";

const tiers: CustomerTierValue[] = ["NORMAL", "PREMIUM", "PREMIUM_PLUS"];
// Cenário real do topup-1000: priceCents órfão (R$ 10) e crédito de R$ 15.
const orphanTiers = { priceCents: 1000, normalPriceCents: null, premiumPriceCents: null, premiumPlusPriceCents: null };
const divergentTiers = { priceCents: 1000, normalPriceCents: 1200, premiumPriceCents: 1100, premiumPlusPriceCents: 900 };

const topupVariant = (id: string, creditAmountCents: number, prices: Record<string, number | null> = orphanTiers) => ({
  id, name: `Recarga ${id}`, code: id, active: true, sortOrder: 1, publicationBlocked: false,
  ...prices,
  providerProduct: topupProviderProduct(creditAmountCents, { id: `pp-${id}` }),
});
const topupProduct = (variants: ReturnType<typeof topupVariant>[]) => ({
  id: "p-topup", slug: "recarga-de-saldo", name: "Recarga de Saldo", description: "", longDescription: null,
  type: "BALANCE_TOPUP", deliveryType: "AUTOMATIC", deliveryEstimate: null, duration: null, imageUrl: null,
  downloadUrl: null, downloadLabel: null, status: "PUBLISHED", available: true, minQuantity: 1, maxQuantity: 1,
  ...orphanTiers, priceVisibility: "LOGIN_REQUIRED", category: null, brand: null, providerProducts: [], variants,
});

describe("preço da Recarga de Saldo = crédito do pacote (P1/P2)", () => {
  it("topupCreditCents só aceita inteiro positivo em metadata.creditAmountCents", () => {
    expect(topupCreditCents({ creditAmountCents: 1500 })).toBe(1500);
    for (const metadata of [null, undefined, {}, [], { creditAmountCents: 0 }, { creditAmountCents: -1 }, { creditAmountCents: 15.5 }, { creditAmountCents: "1500" }])
      expect(topupCreditCents(metadata)).toBeNull();
  });

  it("checkout de BALANCE_TOPUP cobra o crédito em qualquer tier, ignorando priceCents e preços por tier", () => {
    const product = { ...orphanTiers, priceVisibility: "LOGIN_REQUIRED" as const, type: "BALANCE_TOPUP" };
    for (const prices of [orphanTiers, divergentTiers])
      for (const tier of tiers)
        expect(assertCheckoutPrice(product, prices, { customerTier: tier }, { metadata: { creditAmountCents: 1500 } })).toBe(1500);
  });

  it("pacote sem crédito válido não tem preço: nunca cai no priceCents", () => {
    const product = { ...orphanTiers, priceVisibility: "LOGIN_REQUIRED" as const, type: "BALANCE_TOPUP" };
    for (const purchased of [null, undefined, { metadata: null }, { metadata: { creditAmountCents: 0 } }])
      expect(() => assertCheckoutPrice(product, orphanTiers, { customerTier: "NORMAL" }, purchased)).toThrow("PRICE_UNAVAILABLE");
  });

  it("os demais tipos de produto continuam no preço por tier", () => {
    const product = { ...divergentTiers, priceVisibility: "LOGIN_REQUIRED" as const, type: "TOOL" };
    expect(assertCheckoutPrice(product, null, { customerTier: "NORMAL" }, { metadata: { creditAmountCents: 1500 } })).toBe(1200);
  });

  it("a exibição (DTO) mostra o crédito de cada pacote, em qualquer tier; pacote sem crédito some", () => {
    const product = topupProduct([
      topupVariant("v15", 1500),
      topupVariant("v30", 3000, divergentTiers),
      { ...topupVariant("v-bad", 0), providerProduct: { ...topupProviderProduct(1), id: "pp-bad", metadata: {} } },
    ]);
    for (const tier of tiers) {
      const dto = productDto(product as never, { customerTier: tier });
      expect(dto.variants.map((variant) => [variant.id, variant.priceCents])).toEqual([["v15", 1500], ["v30", 3000]]);
      expect(dto.priceCents).toBe(1500);
    }
    expect(productDto(product as never, null)).toMatchObject({ priceVisible: false, priceCents: null });
  });
});

describe("createOrder — recarga topup-1000 cobra 1500 (crédito), nunca o priceCents", () => {
  const account = {
    id: "u1", name: "Cliente", email: "c@example.test", customerTier: "NORMAL", cpfCnpj: "52998224725",
    whatsapp: "5511987654321", asaasCustomerId: null, active: true, balanceTopupBlocked: false,
  };
  const input = { productId: "p-topup", variantId: "topup-1000", deliveryAccessToken: "token-with-enough-characters-000000" };

  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    createPixPayment.mockReset();
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.accountBalance.findUnique.mockResolvedValue({ enabled: true });
    db.product.findFirst.mockResolvedValue(topupProduct([topupVariant("topup-1000", 1500)]));
    db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "o1", ...data }));
    // Para a execução logo após capturar o valor do PIX: o restante do fluxo
    // de PIX não é o assunto deste teste.
    createPixPayment.mockRejectedValue(new Error("STOP_AFTER_PIX"));
  });

  it.each(tiers)("%s: pedido e PIX de R$ 15,00", async (customerTier) => {
    db.user.findFirst.mockResolvedValue({ ...account, customerTier });
    await expect(createOrder(input, "u1")).rejects.toThrow("STOP_AFTER_PIX");
    const data = db.order.create.mock.calls[0][0].data;
    expect(data.totalCents).toBe(1500);
    expect(data.items.create.unitPriceCents).toBe(1500);
    expect(createPixPayment.mock.calls[0][0].amountCents).toBe(1500);
  });
});
