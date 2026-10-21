import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { topupProviderProduct } from "./testing/topup-fixtures";
import { createFakeLedgerDb } from "./testing/fake-ledger-db";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  order: { findUnique: vi.fn(), create: vi.fn() },
  product: { findFirst: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  user: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  accountBalance: { findUnique: vi.fn() },
  payment: { create: vi.fn() },
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
import { handleCheckoutRequest } from "./checkout-route";
import { checkoutErrorMessage } from "./checkout-response";
import { premiumPlusPriceWarning, resolveTierPrice, type CustomerTierValue } from "./commercial-pricing";
import { pixPaymentAllowed } from "./balance-payment";
import { pricingUpdateData, variantPricingUpdateData, type PricingProductSource } from "./pricing-service";
import { adminProductDto, productInputSchema, productVariantInputSchema } from "./admin-catalog";

const viewer = (customerTier: CustomerTierValue) => ({ customerTier });

describe("preço Premium Plus", () => {
  const tiers: CustomerTierValue[] = ["NORMAL", "PREMIUM", "PREMIUM_PLUS"];
  const legacySources = [
    { priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000 },
    { priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: null },
    { priceCents: 3000, normalPriceCents: null, premiumPriceCents: null },
  ];

  it("campo vazio: PREMIUM_PLUS paga exatamente o mesmo que o PREMIUM (comportamento atual)", () => {
    for (const source of legacySources)
      for (const premiumPlusPriceCents of [null, undefined])
        expect(resolveTierPrice({ ...source, premiumPlusPriceCents }, viewer("PREMIUM_PLUS"))).toBe(
          resolveTierPrice(source, viewer("PREMIUM")),
        );
  });

  it("campo preenchido: só o PREMIUM_PLUS usa o preço próprio; os demais tiers e o visitante não mudam", () => {
    const source = { priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: 1700 };
    expect(resolveTierPrice(source, viewer("PREMIUM_PLUS"))).toBe(1700);
    expect(resolveTierPrice(source, viewer("PREMIUM"))).toBe(2000);
    expect(resolveTierPrice(source, viewer("NORMAL"))).toBe(2500);
    expect(resolveTierPrice(source, null)).toBe(3000);
    for (const tier of tiers.filter((tier) => tier !== "PREMIUM_PLUS"))
      expect(resolveTierPrice(source, viewer(tier))).toBe(resolveTierPrice({ ...source, premiumPlusPriceCents: null }, viewer(tier)));
  });

  it("aviso (sem bloqueio) quando o Premium Plus fica acima do preço efetivo do Premium", () => {
    expect(premiumPlusPriceWarning({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: 2100 }))
      .toBe("Atenção: preço Premium Plus maior que o Premium.");
    // Premium vazio: compara com o que o PREMIUM paga de fato (Técnico).
    expect(premiumPlusPriceWarning({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: null, premiumPlusPriceCents: 2600 })).not.toBeNull();
    expect(premiumPlusPriceWarning({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: 2000 })).toBeNull();
    expect(premiumPlusPriceWarning({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: null })).toBeNull();
  });

  it("o Admin aceita salvar Premium Plus vazio, menor ou MAIOR que o Premium", () => {
    const base = {
      name: "P", slug: "p", description: "D", type: "TOOL", priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000,
      pricingMode: "MANUAL", manualPriceCents: 3000, categoryId: "c", status: "DRAFT",
    };
    for (const premiumPlusPriceCents of [null, 1700, 9900]) {
      const parsed = productInputSchema.safeParse({ ...base, premiumPlusPriceCents });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.premiumPlusPriceCents).toBe(premiumPlusPriceCents);
    }
    const variant = productVariantInputSchema.safeParse({ providerProductId: "pp", name: "V", code: "v", premiumPlusPriceCents: 9900 });
    expect(variant.success && variant.data.premiumPlusPriceCents).toBe(9900);
  });

  it("o DTO do Admin carrega o campo do produto e da variante", () => {
    const now = new Date();
    const dto = adminProductDto({
      id: "p", slug: "p", name: "P", description: "D", longDescription: null, type: "TOOL", deliveryType: "AUTOMATIC",
      deliveryEstimate: null, searchTerms: "", duration: null, imageUrl: null, downloadUrl: null, downloadLabel: null,
      priceCents: 3000, priceVisibility: "PUBLIC", normalPriceCents: null, premiumPriceCents: 2000, premiumPlusPriceCents: 1700,
      resellerPriceCents: null, costCents: null, pricingMode: "MANUAL", manualPriceCents: 3000, suggestedPriceCents: null,
      pricingStatus: "MANUAL", pricingComputedAt: null, featured: false, sortOrder: 0, status: "DRAFT", available: true,
      minQuantity: 1, maxQuantity: 1, acceptsSuccessWithoutText: false, categoryId: "c", brandId: null, createdAt: now, updatedAt: now,
      category: { id: "c", name: "C", slug: "c", active: true, createdAt: now, updatedAt: now }, brand: null,
    });
    expect(dto.premiumPlusPriceCents).toBe(1700);
  });

  it("a sincronização automática de preço (custo/câmbio) nunca escreve preços por tier", () => {
    const product = { id: "p", type: "RENTAL", pricingMode: "AUTO_GLOBAL", manualPriceCents: null, priceCents: 2900, providerProducts: [] } satisfies PricingProductSource;
    const result = { pricingStatus: "AUTO_OK", effectivePriceCents: 3100, suggestedPriceCents: 3100 } as Parameters<typeof pricingUpdateData>[1];
    const tierKeys = ["normalPriceCents", "premiumPriceCents", "premiumPlusPriceCents"];
    for (const key of tierKeys) {
      expect(pricingUpdateData(product, result)).not.toHaveProperty(key);
      expect(variantPricingUpdateData({ pricingMode: "AUTO_GLOBAL" } as Parameters<typeof variantPricingUpdateData>[0], result)).not.toHaveProperty(key);
    }
  });
});

describe("PREMIUM_PLUS compra só com saldo (exceto recarga)", () => {
  const product = (type = "TOOL") => ({
    id: "p1", type, deliveryType: "MANUAL", priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000,
    premiumPlusPriceCents: 1700, priceVisibility: "LOGIN_REQUIRED",
    providerProducts: type === "BALANCE_TOPUP" ? [topupProviderProduct(1500)] : [], variants: [],
  });
  // Conta sem CPF/WhatsApp: passar da regra de PIX leva a MISSING_CUSTOMER_FIELDS
  // — prova de que o bloqueio não disparou, sem simular o PIX inteiro.
  const incomplete = (customerTier: string) => ({
    id: "u1", name: "Cliente", email: "c@example.test", customerTier, cpfCnpj: null, whatsapp: null, asaasCustomerId: null, active: true,
  });
  const complete = { ...incomplete("PREMIUM_PLUS"), cpfCnpj: "52998224725", whatsapp: "5511987654321" };
  const input = (paymentMethod?: string) => ({ productId: "p1", deliveryAccessToken: "token-with-enough-characters-000000", ...(paymentMethod ? { paymentMethod } : {}) });

  beforeEach(() => {
    for (const model of Object.values(db))
      if (typeof model === "function") (model as ReturnType<typeof vi.fn>).mockReset();
      else for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.product.findFirst.mockResolvedValue(product());
  });

  it("regra pura: só PREMIUM_PLUS perde o PIX, e nunca na recarga; visitante mantém o PIX", () => {
    expect(pixPaymentAllowed({ customerTier: "PREMIUM_PLUS" }, "TOOL")).toBe(false);
    expect(pixPaymentAllowed({ customerTier: "PREMIUM_PLUS" }, "BALANCE_TOPUP")).toBe(true);
    expect(pixPaymentAllowed({ customerTier: "PREMIUM" }, "TOOL")).toBe(true);
    expect(pixPaymentAllowed({ customerTier: "NORMAL" }, "TOOL")).toBe(true);
    expect(pixPaymentAllowed(null, "TOOL")).toBe(true);
  });

  it.each([undefined, "pix"])("PREMIUM_PLUS com paymentMethod %s é recusado antes de criar pedido ou PIX", async (method) => {
    db.user.findFirst.mockResolvedValue(complete);
    await expect(createOrder(input(method), "u1")).rejects.toThrow("PIX_NOT_ALLOWED_FOR_TIER");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("PREMIUM_PLUS continua podendo recarregar saldo via PIX", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    db.accountBalance.findUnique.mockResolvedValue({ enabled: true });
    db.user.findFirst.mockResolvedValue(incomplete("PREMIUM_PLUS"));
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
  });

  it.each(["NORMAL", "PREMIUM"])("%s segue com PIX como antes", async (tier) => {
    db.user.findFirst.mockResolvedValue(incomplete(tier));
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
  });

  it("visitante segue com PIX como antes", async () => {
    db.product.findFirst.mockResolvedValue({ ...product(), priceVisibility: "PUBLIC" });
    await expect(createOrder(input("pix"))).rejects.toThrow("INVALID_CUSTOMER_DATA");
  });

  it("PREMIUM_PLUS paga com saldo o preço Premium Plus", async () => {
    const ledger = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    db.user.findFirst.mockResolvedValue(complete);
    db.user.findUnique.mockResolvedValue({ canUseBalanceAsPayment: false, customerTier: "PREMIUM_PLUS", accountBalance: { enabled: true, balanceCents: 5000 } });
    db.order.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "o1", status: "PAID" });
    db.order.create.mockImplementation(async ({ data }: { data: { publicToken: string; totalCents: number } }) => ({ id: "o1", publicToken: data.publicToken, totalCents: data.totalCents }));
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      ledger.$transaction(() => fn({ ...ledger, order: { create: db.order.create } })),
    );
    await createOrder(input("balance"), "u1");
    expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalCents: 1700 }) }));
    expect(ledger.state.entries).toEqual([expect.objectContaining({ type: "PURCHASE", amountCents: -1700 })]);
  });

  it("saldo insuficiente não cai para o PIX: a compra é recusada", async () => {
    db.user.findFirst.mockResolvedValue(complete);
    db.user.findUnique.mockResolvedValue({ canUseBalanceAsPayment: false, customerTier: "PREMIUM_PLUS", accountBalance: { enabled: true, balanceCents: 100 } });
    await expect(createOrder(input("balance"), "u1")).rejects.toThrow("INSUFFICIENT_BALANCE");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("a rota responde 403 com a mensagem combinada, e o painel a exibe", async () => {
    const request = new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input("pix")),
    });
    const response = await handleCheckoutRequest(request, async () => {
      throw new Error("PIX_NOT_ALLOWED_FOR_TIER");
    });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toEqual({
      ok: false,
      code: "PIX_NOT_ALLOWED_FOR_TIER",
      error: "Sua conta usa apenas saldo para compras. Recarregue seu saldo para continuar.",
    });
    expect(checkoutErrorMessage(403, payload)).toBe(payload.error);
  });
});

describe("painel de checkout sem PIX para PREMIUM_PLUS", () => {
  const source = readFileSync(path.resolve(__dirname, "../components/checkout-panel.tsx"), "utf8");
  const page = readFileSync(path.resolve(__dirname, "../app/produto/[slug]/page.tsx"), "utf8");

  it("a página calcula a regra no servidor e repassa ao painel", () => {
    expect(page).toContain("const pixAllowed = pixPaymentAllowed(account, found.type);");
    expect(page).toContain("pixAllowed={pixAllowed}");
  });

  it("o botão PIX e a opção PIX só aparecem quando o PIX é permitido; o padrão vira saldo", () => {
    expect(source).toContain("{(pixAllowed || !product.available) && (");
    expect(source).toContain("{pixAllowed && (\n                        <label");
    expect(source).toContain('useState<"pix" | "balance">(pixAllowed ? "pix" : "balance")');
  });

  it("nunca envia checkout PIX sem permissão e avisa quando o saldo não está habilitado", () => {
    expect(source).toContain("if (!pixAllowed && !payingWithBalance) return;");
    expect(source).toContain("As compras desta conta são feitas com saldo");
  });
});
