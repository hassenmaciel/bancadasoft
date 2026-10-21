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
import { handleCheckoutRequest } from "./checkout-route";
import { checkoutErrorMessage } from "./checkout-response";
import { checkoutSchema } from "./checkout-schema";
import {
  INVALID_TOPUP_AMOUNT_MESSAGE,
  assertCheckoutPrice,
  parseTopupAmountInput,
  topupCreditCents,
  validTopupAmountCents,
} from "./commercial-pricing";
import { productDto } from "./dto";
import { BalanceTopupAdapter } from "./providers/internal-balance";
import { createFakeLedgerDb } from "./testing/fake-ledger-db";

const freePackage = () => topupProviderProduct(0, { id: "pp-free", externalProductId: "topup-free", metadata: { freeAmount: true } });
const variant = (id: string, providerProduct: ReturnType<typeof topupProviderProduct>, sortOrder = 1) => ({
  id, name: id === "free" ? "Outro valor" : `Recarga ${id}`, code: id, active: true, sortOrder, publicationBlocked: false,
  priceCents: 1500, normalPriceCents: 1500, premiumPriceCents: null, premiumPlusPriceCents: null, providerProduct,
});
const topupProduct = (variants: ReturnType<typeof variant>[]) => ({
  id: "p-topup", slug: "recarga-de-saldo", name: "Recarga de Saldo", description: "", longDescription: null,
  type: "BALANCE_TOPUP", deliveryType: "AUTOMATIC", deliveryEstimate: null, duration: null, imageUrl: null,
  downloadUrl: null, downloadLabel: null, status: "PUBLISHED", available: true, minQuantity: 1, maxQuantity: 1,
  priceCents: 1500, normalPriceCents: null, premiumPriceCents: null, premiumPlusPriceCents: null,
  priceVisibility: "LOGIN_REQUIRED", category: null, brand: null, providerProducts: [], variants,
});
const product = { priceCents: 1500, priceVisibility: "LOGIN_REQUIRED" as const, type: "BALANCE_TOPUP" };
const viewer = { customerTier: "NORMAL" as const };

describe("recarga 'Outro valor' — limites R$ 15,00 a R$ 5.000,00 (O1/O3)", () => {
  it("valor digitado → centavos; validação de limites e de inteiro", () => {
    expect(parseTopupAmountInput("14,99")).toBe(1499);
    expect(parseTopupAmountInput("15")).toBe(1500);
    expect(parseTopupAmountInput("15.00")).toBe(1500);
    expect(parseTopupAmountInput("1.234,56")).toBe(123456);
    expect(parseTopupAmountInput("5000,01")).toBe(500001);
    for (const text of ["", "abc", "15,999", "-15", "R$"]) expect(parseTopupAmountInput(text)).toBeNull();
    expect(validTopupAmountCents(1499)).toBeNull();
    expect(validTopupAmountCents(1500)).toBe(1500);
    expect(validTopupAmountCents(500000)).toBe(500000);
    expect(validTopupAmountCents(500001)).toBeNull();
    expect(validTopupAmountCents(1500.5)).toBeNull();
    expect(validTopupAmountCents(undefined)).toBeNull();
  });

  it("checkout do pacote livre cobra exatamente o valor válido; fora dos limites é recusado com código próprio", () => {
    const purchased = { metadata: { freeAmount: true } };
    expect(assertCheckoutPrice(product, null, viewer, purchased, 1500)).toBe(1500);
    expect(assertCheckoutPrice(product, null, viewer, purchased, 500000)).toBe(500000);
    for (const amount of [1499, 500001, 1500.5, undefined])
      expect(() => assertCheckoutPrice(product, null, viewer, purchased, amount)).toThrow("INVALID_TOPUP_AMOUNT");
  });

  it("o mínimo vale para todas as recargas: pacote fixo abaixo de R$ 15,00 deixa de ser vendável", () => {
    expect(topupCreditCents({ creditAmountCents: 1000 })).toBeNull();
    expect(topupCreditCents({ creditAmountCents: 1500 })).toBe(1500);
    expect(() => assertCheckoutPrice(product, null, viewer, { metadata: { creditAmountCents: 1000 } })).toThrow("PRICE_UNAVAILABLE");
    // Pacote fixo ignora qualquer valor enviado: cobra o crédito do pacote.
    expect(assertCheckoutPrice(product, null, viewer, { metadata: { creditAmountCents: 3000 } }, 999999)).toBe(3000);
  });

  it("DTO: 'Outro valor' aparece com o mínimo e a marca de valor livre; pacote fixo abaixo do mínimo some", () => {
    const dto = productDto(topupProduct([
      variant("v15", topupProviderProduct(1500), 1),
      variant("v10", topupProviderProduct(1000, { id: "pp-10" }), 2),
      variant("free", freePackage(), 3),
    ]) as never, viewer);
    expect(dto.variants.map((v) => [v.id, v.priceCents, v.freeAmount ?? false])).toEqual([["v15", 1500, false], ["free", 1500, true]]);
  });

  it("schema do checkout aceita topupAmountCents numérico e recusa texto", () => {
    const base = { productId: "p", deliveryAccessToken: "token-with-enough-characters-000000" };
    expect(checkoutSchema.safeParse({ ...base, topupAmountCents: 1500 }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, topupAmountCents: "1500" }).success).toBe(false);
  });

  it("a rota traduz INVALID_TOPUP_AMOUNT em 422 com mensagem clara, exibida pelo painel", async () => {
    const request = new Request("https://test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: "p", deliveryAccessToken: "isolated-delivery-token-with-32-characters", topupAmountCents: 1499 }),
    });
    const response = await handleCheckoutRequest(request, async () => { throw new Error("INVALID_TOPUP_AMOUNT"); });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toEqual({ ok: false, code: "INVALID_TOPUP_AMOUNT", error: INVALID_TOPUP_AMOUNT_MESSAGE });
    expect(checkoutErrorMessage(422, body)).toBe(INVALID_TOPUP_AMOUNT_MESSAGE);
  });
});

describe("createOrder — recarga 'Outro valor' (servidor)", () => {
  const account = {
    id: "u1", name: "Cliente", email: "c@example.test", customerTier: "NORMAL", cpfCnpj: "52998224725",
    whatsapp: "5511987654321", asaasCustomerId: null, active: true, balanceTopupBlocked: false,
  };
  const input = (topupAmountCents?: number) => ({
    productId: "p-topup", variantId: "free", deliveryAccessToken: "token-with-enough-characters-000000",
    ...(topupAmountCents === undefined ? {} : { topupAmountCents }),
  });

  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    createPixPayment.mockReset();
    createPixPayment.mockRejectedValue(new Error("STOP_AFTER_PIX"));
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.user.findFirst.mockResolvedValue(account);
    db.product.findFirst.mockResolvedValue(topupProduct([variant("free", freePackage())]));
    db.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "o1", ...data }));
  });

  it.each([1499, 500001, undefined])("valor %s recusado antes de criar pedido ou PIX", async (amount) => {
    await expect(createOrder(input(amount), "u1")).rejects.toThrow("INVALID_TOPUP_AMOUNT");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it.each([1500, 500000])("valor %s aceito: pedido e PIX exatamente nesse valor", async (amount) => {
    await expect(createOrder(input(amount), "u1")).rejects.toThrow("STOP_AFTER_PIX");
    const data = db.order.create.mock.calls[0][0].data;
    expect(data.totalCents).toBe(amount);
    expect(data.items.create.unitPriceCents).toBe(amount);
    expect(createPixPayment.mock.calls[0][0].amountCents).toBe(amount);
  });
});

describe("crédito do pacote 'Outro valor' (adapter interno)", () => {
  const setup = (providerProduct: { externalProductId: string; metadata: unknown }, unitPriceCents: number) => {
    const db = createFakeLedgerDb({
      users: [{ id: "buyer", role: "USER", active: true, passwordHash: "hash", customerTier: "NORMAL" }],
      orders: [{ id: "order-1", customerId: "buyer", unitPriceCents, quantity: 1, providerProduct: { ...providerProduct, provider: { code: "internal-balance" } } }],
    });
    return { db, adapter: new BalanceTopupAdapter(db as never) };
  };
  const run = (adapter: BalanceTopupAdapter, providerProductId: string) =>
    adapter.createOrder({ providerProductId, reference: "r", payload: { orderId: "order-1", paidAmountCents: 1, Quantity: 1, fields: {} } });

  it("credita o valor validado gravado no pedido (e promove, como qualquer recarga)", async () => {
    const { db, adapter } = setup({ externalProductId: "topup-free", metadata: { freeAmount: true } }, 4321);
    await run(adapter, "topup-free");
    expect(db.state.entries[0]).toMatchObject({ type: "TOPUP", amountCents: 4321 });
    expect(db.state.users[0].customerTier).toBe("PREMIUM_PLUS");
  });

  it("pacote fixo continua creditando o metadata, nunca o valor do pedido", async () => {
    const { db, adapter } = setup({ externalProductId: "topup-3000", metadata: { creditAmountCents: 3000 } }, 9999);
    await run(adapter, "topup-3000");
    expect(db.state.entries[0].amountCents).toBe(3000);
  });
});
