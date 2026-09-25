import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { assertBalanceTopupAllowed } from "./commercial-pricing";
import { handleCheckoutRequest } from "./checkout-route";

const product = (type: string) => ({
  id: "p1",
  type,
  deliveryType: "MANUAL",
  priceCents: 1000,
  normalPriceCents: null,
  premiumPriceCents: null,
  priceVisibility: "LOGIN_REQUIRED",
  providerProducts: [],
  variants: [],
});
// Conta sem CPF/WhatsApp: se o guard deixar passar, o próximo passo do
// checkout lança IncompleteCheckoutIdentityError — prova de que o guard passou
// sem precisar simular o resto do fluxo (PIX etc.).
const account = { id: "u1", name: "Cliente", email: "c@example.test", customerTier: "NORMAL", cpfCnpj: null, whatsapp: null, asaasCustomerId: null, active: true };
const input = { productId: "p1", deliveryAccessToken: "token-with-enough-characters-000000" };

describe("guard de checkout da Recarga de Saldo (BALANCE_TOPUP)", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    db.order.findUnique.mockResolvedValue(null);
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.user.findFirst.mockResolvedValue(account);
  });

  it("função pura: só age em BALANCE_TOPUP; exige login e saldo habilitado", () => {
    expect(() => assertBalanceTopupAllowed("TOOL", { authenticated: false, balanceEnabled: false })).not.toThrow();
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: false, balanceEnabled: true })).toThrow("LOGIN_REQUIRED_FOR_PRICE");
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: true, balanceEnabled: false })).toThrow("BALANCE_NOT_ENABLED");
    expect(() => assertBalanceTopupAllowed("BALANCE_TOPUP", { authenticated: true, balanceEnabled: true })).not.toThrow();
  });

  it("bloqueia com BALANCE_NOT_ENABLED antes de criar Order/Payment quando o saldo está desabilitado ou sem linha", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    for (const balance of [{ enabled: false }, null]) {
      db.accountBalance.findUnique.mockResolvedValueOnce(balance);
      await expect(createOrder(input, "u1")).rejects.toThrow("BALANCE_NOT_ENABLED");
    }
    expect(db.order.create).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("deixa seguir quando o saldo está habilitado", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    db.accountBalance.findUnique.mockResolvedValue({ enabled: true });
    await expect(createOrder(input, "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
    expect(db.accountBalance.findUnique).toHaveBeenCalledWith({ where: { userId: "u1" }, select: { enabled: true } });
  });

  it("não afeta outros tipos de produto: nenhuma consulta de saldo", async () => {
    db.product.findFirst.mockResolvedValue(product("TOOL"));
    await expect(createOrder(input, "u1")).rejects.toThrow("MISSING_CUSTOMER_FIELDS");
    expect(db.accountBalance.findUnique).not.toHaveBeenCalled();
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
