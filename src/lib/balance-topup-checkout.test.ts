import { beforeEach, describe, expect, it, vi } from "vitest";
import { topupProviderProduct } from "./testing/topup-fixtures";

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), create: vi.fn() },
  product: { findFirst: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  user: { findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  accountBalance: { findUnique: vi.fn() },
  payment: { create: vi.fn() },
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
import { assertBalanceTopupAllowed, BALANCE_TOPUP_BLOCKED_MESSAGE } from "./commercial-pricing";
import { checkoutErrorMessage } from "./checkout-response";
import { handleCheckoutRequest } from "./checkout-route";

const product = (type: string) => ({
  id: "p1",
  type,
  deliveryType: "MANUAL",
  priceCents: 1000,
  normalPriceCents: null,
  premiumPriceCents: null,
  priceVisibility: "LOGIN_REQUIRED",
  providerProducts: type === "BALANCE_TOPUP" ? [topupProviderProduct(1500)] : [],
  variants: [],
});
// Conta sem CPF/WhatsApp: se o guard deixar passar, o próximo passo do
// checkout lança IncompleteCheckoutIdentityError — prova de que o guard passou
// sem precisar simular o resto do fluxo (PIX etc.).
const account = { id: "u1", name: "Cliente", email: "c@example.test", customerTier: "NORMAL", cpfCnpj: null, whatsapp: null, asaasCustomerId: null, active: true, balanceTopupBlocked: false };
const input = { productId: "p1", deliveryAccessToken: "token-with-enough-characters-000000" };

describe("guard de checkout da Recarga de Saldo (BALANCE_TOPUP)", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.user.findFirst.mockResolvedValue(account);
  });

  it("função pura: só age em BALANCE_TOPUP; exige login e recarga não bloqueada", () => {
    expect(() => assertBalanceTopupAllowed("TOOL", { authenticated: false, topupBlocked: true })).not.toThrow();
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: false, topupBlocked: false })).toThrow("LOGIN_REQUIRED_FOR_PRICE");
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: true, topupBlocked: true })).toThrow("BALANCE_TOPUP_BLOCKED");
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: true, topupBlocked: false })).not.toThrow();
  });

  it("qualquer cliente logado recarrega, com saldo desabilitado ou sem linha: AccountBalance nem é consultado", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    for (const customerTier of ["NORMAL", "PREMIUM", "PREMIUM_PLUS"]) {
      db.user.findFirst.mockResolvedValueOnce({ ...account, customerTier, balanceTopupBlocked: false });
      await expect(createOrder(input, "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
    }
    expect(db.accountBalance.findUnique).not.toHaveBeenCalled();
  });

  it("recarga bloqueada pelo Admin: BALANCE_TOPUP_BLOCKED antes de criar Order/Payment", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    db.user.findFirst.mockResolvedValue({ ...account, balanceTopupBlocked: true });
    await expect(createOrder(input, "u1")).rejects.toThrow("BALANCE_TOPUP_BLOCKED");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("visitante continua sem recarga (login obrigatório)", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    await expect(createOrder(input)).rejects.toThrow("LOGIN_REQUIRED_FOR_PRICE");
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("bloqueio não afeta outros tipos de produto", async () => {
    db.product.findFirst.mockResolvedValue(product("TOOL"));
    db.user.findFirst.mockResolvedValue({ ...account, balanceTopupBlocked: true });
    await expect(createOrder(input, "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
    expect(db.accountBalance.findUnique).not.toHaveBeenCalled();
  });

  it("a rota de checkout traduz BALANCE_TOPUP_BLOCKED em 403 com mensagem clara", async () => {
    const request = new Request("https://test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, deliveryAccessToken: "isolated-delivery-token-with-32-characters" }),
    });
    const response = await handleCheckoutRequest(request, async () => { throw new Error("BALANCE_TOPUP_BLOCKED"); });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ ok: false, code: "BALANCE_TOPUP_BLOCKED", error: BALANCE_TOPUP_BLOCKED_MESSAGE });
    expect(checkoutErrorMessage(403, body)).toBe(BALANCE_TOPUP_BLOCKED_MESSAGE);
  });

  it("a rota de checkout traduz BALANCE_NOT_ENABLED em 403 com código claro", async () => {
    const request = new Request("https://test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, name: "Cliente Teste", email: "c@example.test", whatsapp: "11999999999", cpfCnpj: "52998224725", deliveryAccessToken: "isolated-delivery-token-with-32-characters" }),
    });
    const response = await handleCheckoutRequest(request, async () => { throw new Error("BALANCE_NOT_ENABLED"); });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, code: "BALANCE_NOT_ENABLED" });
  });
});
