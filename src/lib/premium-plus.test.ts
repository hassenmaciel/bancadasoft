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
import { PIX_PRICE_UNAVAILABLE_MESSAGE, premiumPlusPixPrice, premiumPlusPriceWarning, resolveTierPrice, type CustomerTierValue } from "./commercial-pricing";
import { premiumPlusPayment } from "./balance-payment";
import { productDto } from "./dto";
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

describe("PREMIUM_PLUS: saldo ao preço Plus só se cobrir; senão PIX ao menor Premium/Técnico (R3/R4)", () => {
  // Plus 17,00 | Premium 20,00 | Técnico 25,00 | Público 30,00 → PIX do PREMIUM_PLUS = 20,00.
  const product = (type = "TOOL", prices: Record<string, number | null> = {}) => ({
    id: "p1", type, deliveryType: "MANUAL", priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000,
    premiumPlusPriceCents: 1700, priceVisibility: "LOGIN_REQUIRED", ...prices,
    providerProducts: type === "BALANCE_TOPUP" ? [topupProviderProduct(1500)] : [], variants: [] as unknown[],
  });
  // Conta sem CPF/WhatsApp: passar das regras de pagamento leva a
  // MISSING_CUSTOMER_FIELDS — prova de que nenhum bloqueio disparou.
  const incomplete = (customerTier: string) => ({
    id: "u1", name: "Cliente", email: "c@example.test", customerTier, cpfCnpj: null, whatsapp: null, asaasCustomerId: null, active: true,
  });
  const complete = (customerTier = "PREMIUM_PLUS") => ({ ...incomplete(customerTier), cpfCnpj: "52998224725", whatsapp: "5511987654321" });
  const input = (paymentMethod?: string) => ({ productId: "p1", deliveryAccessToken: "token-with-enough-characters-000000", ...(paymentMethod ? { paymentMethod } : {}) });
  const plusAccount = (balance: { enabled: boolean; balanceCents: number } | null) => ({
    canUseBalanceAsPayment: true, customerTier: "PREMIUM_PLUS", accountBalance: balance,
  });
  // PIX real até a criação da cobrança; para logo depois de capturar o valor.
  const pixCharge = async () => {
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("STOP_AFTER_PIX");
    return { order: db.order.create.mock.calls[0][0].data.totalCents, pix: createPixPayment.mock.calls[0][0].amountCents };
  };

  beforeEach(() => {
    for (const model of Object.values(db))
      if (typeof model === "function") (model as ReturnType<typeof vi.fn>).mockReset();
      else for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    createPixPayment.mockRejectedValue(new Error("STOP_AFTER_PIX"));
    db.order.findUnique.mockResolvedValue(null);
    db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "o1", ...data }));
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.product.findFirst.mockResolvedValue(product());
  });

  it("preço PIX do PREMIUM_PLUS: menor preço ativo entre Premium e Técnico; nunca Plus nem Público", () => {
    expect(premiumPlusPixPrice({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: 1700 })).toBe(2000);
    expect(premiumPlusPixPrice({ priceCents: 3000, normalPriceCents: 1900, premiumPriceCents: 2000, premiumPlusPriceCents: 1700 })).toBe(1900);
    expect(premiumPlusPixPrice({ priceCents: 3000, normalPriceCents: null, premiumPriceCents: 2000, premiumPlusPriceCents: 1700 })).toBe(2000);
    expect(premiumPlusPixPrice({ priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 0, premiumPlusPriceCents: 1700 })).toBe(2500);
    expect(premiumPlusPixPrice({ priceCents: 3000, normalPriceCents: null, premiumPriceCents: null, premiumPlusPriceCents: 1700 })).toBeNull();
  });

  it("regra pura: saldo habilitado que cobre o total ao preço Plus → saldo; qualquer outro caso → PIX", () => {
    const prices = { plusPriceCents: 1700, pixPriceCents: 2000 };
    expect(premiumPlusPayment({ enabled: true, balanceCents: 1700 }, prices, 1)).toEqual({ method: "balance", unitCents: 1700 });
    expect(premiumPlusPayment({ enabled: true, balanceCents: 3399 }, prices, 2)).toEqual({ method: "pix", unitCents: 2000 });
    expect(premiumPlusPayment({ enabled: false, balanceCents: 99999 }, prices, 1)).toEqual({ method: "pix", unitCents: 2000 });
    expect(premiumPlusPayment(null, prices, 1)).toEqual({ method: "pix", unitCents: 2000 });
    expect(premiumPlusPayment(null, { plusPriceCents: 1700, pixPriceCents: null }, 1)).toEqual({ method: "pix", unitCents: null });
  });

  it("com saldo suficiente paga com saldo o preço Premium Plus (débito atômico no ledger)", async () => {
    const ledger = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount({ enabled: true, balanceCents: 5000 }));
    db.order.findUnique.mockReset();
    db.order.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "o1", status: "PAID" });
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      ledger.$transaction(() => fn({ ...ledger, order: { create: db.order.create } })),
    );
    await createOrder(input("balance"), "u1");
    expect(db.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalCents: 1700 }) }));
    expect(ledger.state.entries).toEqual([expect.objectContaining({ type: "PURCHASE", amountCents: -1700 })]);
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it.each([
    ["saldo menor que o total Plus", { enabled: true, balanceCents: 1000 }],
    ["saldo desabilitado", { enabled: false, balanceCents: 99999 }],
    ["sem linha de saldo", null],
  ])("sem saldo que cubra (%s): PIX ao preço Premium (20,00), nunca o Plus", async (_label, balance) => {
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount(balance));
    expect(await pixCharge()).toEqual({ order: 2000, pix: 2000 });
  });

  it("sem paymentMethod (padrão PIX) segue a mesma regra", async () => {
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount(null));
    await expect(createOrder(input(), "u1")).rejects.toThrow("STOP_AFTER_PIX");
    expect(createPixPayment.mock.calls[0][0].amountCents).toBe(2000);
  });

  it("o total considera a quantidade: saldo que cobre 1 unidade mas não 2 leva ao PIX", async () => {
    db.product.findFirst.mockResolvedValue({ ...product(), minQuantity: 1, maxQuantity: 5 });
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount({ enabled: true, balanceCents: 2000 }));
    await expect(createOrder({ ...input("pix"), quantity: 2 }, "u1")).rejects.toThrow("STOP_AFTER_PIX");
    expect(createPixPayment.mock.calls[0][0].amountCents).toBe(4000);
  });

  it("variante: o preço PIX vem da variante, não do produto", async () => {
    const variant = {
      id: "v1", name: "V1", code: "v1", active: true, sortOrder: 1, publicationBlocked: false,
      priceCents: 9000, normalPriceCents: 8000, premiumPriceCents: 7000, premiumPlusPriceCents: 6000,
      providerProduct: topupProviderProduct(1, { id: "pp-v1", externalProductId: "x-v1", metadata: null }),
    };
    db.product.findFirst.mockResolvedValue({ ...product(), variants: [variant] });
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount(null));
    await expect(createOrder({ ...input("pix"), variantId: "v1" }, "u1")).rejects.toThrow("STOP_AFTER_PIX");
    expect(createPixPayment.mock.calls[0][0].amountCents).toBe(7000);
  });

  it("saldo cobre: PIX continua recusado (único caso em que o bloqueio permanece), sem pedido nem cobrança", async () => {
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount({ enabled: true, balanceCents: 1700 }));
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("PIX_NOT_ALLOWED_FOR_TIER");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("sem Premium nem Técnico ativos: PIX recusado com código próprio, sem cobrar o Plus", async () => {
    db.product.findFirst.mockResolvedValue(product("TOOL", { normalPriceCents: null, premiumPriceCents: 0 }));
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount({ enabled: true, balanceCents: 100 }));
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("PIX_PRICE_UNAVAILABLE_FOR_TIER");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("saldo insuficiente pedindo saldo continua recusado (sem pagamento misto)", async () => {
    db.user.findFirst.mockResolvedValue(complete());
    db.user.findUnique.mockResolvedValue(plusAccount({ enabled: true, balanceCents: 100 }));
    await expect(createOrder(input("balance"), "u1")).rejects.toThrow("INSUFFICIENT_BALANCE");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("PREMIUM_PLUS continua podendo recarregar saldo via PIX", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    db.user.findFirst.mockResolvedValue(incomplete("PREMIUM_PLUS"));
    await expect(createOrder(input("pix"), "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
  });

  it.each([["NORMAL", 2500], ["PREMIUM", 2000]])("%s: PIX inalterado (preço do tier, sem consultar saldo)", async (tier, cents) => {
    db.user.findFirst.mockResolvedValue(complete(tier as string));
    expect(await pixCharge()).toEqual({ order: cents, pix: cents });
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("visitante segue com PIX como antes", async () => {
    db.product.findFirst.mockResolvedValue({ ...product(), priceVisibility: "PUBLIC" });
    await expect(createOrder(input("pix"))).rejects.toThrow("INVALID_CUSTOMER_DATA");
  });

  it("a rota traduz os dois códigos do PIX do PREMIUM_PLUS e o painel exibe o texto do servidor", async () => {
    const request = () => new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input("pix")),
    });
    const covered = await handleCheckoutRequest(request(), async () => { throw new Error("PIX_NOT_ALLOWED_FOR_TIER"); });
    expect(covered.status).toBe(403);
    const coveredBody = await covered.json();
    expect(coveredBody).toEqual({ ok: false, code: "PIX_NOT_ALLOWED_FOR_TIER", error: "Seu saldo cobre esta compra: conclua o pagamento com saldo." });
    expect(checkoutErrorMessage(403, coveredBody)).toBe(coveredBody.error);
    const noPrice = await handleCheckoutRequest(request(), async () => { throw new Error("PIX_PRICE_UNAVAILABLE_FOR_TIER"); });
    expect(noPrice.status).toBe(422);
    const noPriceBody = await noPrice.json();
    expect(noPriceBody).toEqual({ ok: false, code: "PIX_PRICE_UNAVAILABLE_FOR_TIER", error: PIX_PRICE_UNAVAILABLE_MESSAGE });
    expect(checkoutErrorMessage(422, noPriceBody)).toBe(PIX_PRICE_UNAVAILABLE_MESSAGE);
  });
});

describe("exibição do PREMIUM_PLUS: preço Plus só com saldo que cubra (DTO, página, API)", () => {
  const base = {
    id: "p1", slug: "p", name: "P", description: "", longDescription: null, type: "TOOL", deliveryType: "MANUAL",
    deliveryEstimate: null, duration: null, imageUrl: null, downloadUrl: null, downloadLabel: null, status: "PUBLISHED",
    available: true, minQuantity: 1, maxQuantity: 1, priceVisibility: "LOGIN_REQUIRED", category: null, brand: null,
    providerProducts: [] as unknown[], variants: [] as unknown[],
    priceCents: 3000, normalPriceCents: 2500, premiumPriceCents: 2000, premiumPlusPriceCents: 1700,
  };
  const dto = (balance: { enabled: boolean; balanceCents: number } | null, tier: CustomerTierValue = "PREMIUM_PLUS", extra: Record<string, unknown> = {}) =>
    productDto({ ...base, ...extra } as never, { customerTier: tier }, balance);

  it("saldo cobre: exibe 17,00 (Plus) em modo saldo, com os dois preços para a tela", () => {
    expect(dto({ enabled: true, balanceCents: 1700 })).toMatchObject({
      priceCents: 1700, priceMode: "balance", premiumPlus: { plusPriceCents: 1700, pixPriceCents: 2000 },
    });
  });

  it.each([
    ["saldo menor", { enabled: true, balanceCents: 1699 }],
    ["saldo desabilitado", { enabled: false, balanceCents: 99999 }],
    ["sem saldo", null],
  ])("sem saldo que cubra (%s): exibe 20,00 (PIX), nunca 17,00", (_label, balance) => {
    const shown = dto(balance);
    expect(shown).toMatchObject({ priceCents: 2000, priceMode: "pix" });
    expect(shown.priceCents).not.toBe(1700);
  });

  it("variantes: cada uma mostra o preço da forma que o saldo permite; o 'a partir de' nunca é um Plus sem saldo", () => {
    const variant = (id: string, plus: number, premium: number | null, normal: number | null) => ({
      id, name: id, active: true, sortOrder: 1, publicationBlocked: false,
      priceCents: 9000, normalPriceCents: normal, premiumPriceCents: premium, premiumPlusPriceCents: plus,
      providerProduct: topupProviderProduct(1, { id: `pp-${id}`, metadata: null }),
    });
    const shown = dto({ enabled: true, balanceCents: 1000 }, "PREMIUM_PLUS", {
      variants: [variant("cabe", 900, 1200, 1500), variant("nao-cabe", 1100, 1400, 1300), variant("sem-pix", 1050, null, null)],
    });
    expect(shown.variants.map((v) => [v.id, v.priceCents])).toEqual([["cabe", 900], ["nao-cabe", 1300]]);
    expect(shown).toMatchObject({ priceCents: 900, priceMode: "balance" });
  });

  it("sem Premium nem Técnico ativos e sem saldo: nenhum preço exibido (nunca o Plus)", () => {
    expect(dto(null, "PREMIUM_PLUS", { normalPriceCents: null, premiumPriceCents: null }).priceCents).toBeNull();
  });

  it("NORMAL e PREMIUM: exibição inalterada, sem campos do PREMIUM_PLUS", () => {
    for (const [tier, cents] of [["NORMAL", 2500], ["PREMIUM", 2000]] as const) {
      const shown = dto({ enabled: true, balanceCents: 99999 }, tier);
      expect(shown.priceCents).toBe(cents);
      expect(shown).not.toHaveProperty("priceMode");
      expect(shown).not.toHaveProperty("premiumPlus");
    }
  });

  it("recarga: PREMIUM_PLUS vê o crédito do pacote, sem regra de saldo", () => {
    const shown = dto(null, "PREMIUM_PLUS", { type: "BALANCE_TOPUP", providerProducts: [topupProviderProduct(1500)] });
    expect(shown).toMatchObject({ priceCents: 1500 });
    expect(shown).not.toHaveProperty("premiumPlus");
  });

  it("a página e a API passam o saldo ao DTO; o rótulo Premium Plus só aparece em modo saldo", () => {
    const page = readFileSync(path.resolve(__dirname, "../app/produto/[slug]/page.tsx"), "utf8");
    const api = readFileSync(path.resolve(__dirname, "../app/api/products/route.ts"), "utf8");
    const card = readFileSync(path.resolve(__dirname, "../components/product-card.tsx"), "utf8");
    expect(page).toContain("productDto(found, viewer, account?.accountBalance ?? null)");
    expect(page).toContain('dto.priceMode === "balance" ? "Preço Premium Plus · " : ""');
    expect(api).toContain("productDto(product, viewer, balance)");
    expect(card).toContain('product.priceMode==="balance"?"Preço Premium Plus · ":""');
  });
});
