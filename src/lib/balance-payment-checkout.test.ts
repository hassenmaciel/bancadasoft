import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
const executeFulfillment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/fulfillment-engine", () => ({ executeFulfillment, safeErrorInfo: () => ({}) }));
vi.mock("@/lib/guest-delivery", () => ({
  createDeliveryAccess: () => ({ token: "t", tokenHash: "h", encryptedToken: "e", expiresAt: new Date() }),
}));
const createPixPayment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/registry", () => ({
  configuredPaymentProviderCode: () => "mock",
  getPaymentProvider: (code: string) => (code === "mock" ? { code: "mock", createPixPayment } : undefined),
}));

import { createOrder } from "./commerce";
import { handleCheckoutRequest } from "./checkout-route";
import { BALANCE_CHECKOUT_FALLBACK_ERROR, CHECKOUT_FALLBACK_ERROR, checkoutErrorMessage } from "./checkout-response";
import {
  balancePaymentOption,
  balanceShortfallCents,
  hasBalancePaymentPermission,
  productAcceptsBalancePayment,
} from "./balance-payment";

const product = (type = "TOOL") => ({
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
// Conta com cadastro completo: o checkout segue até o caminho de pagamento.
const account = {
  id: "u1",
  name: "Cliente",
  email: "c@example.test",
  customerTier: "NORMAL",
  cpfCnpj: "52998224725",
  whatsapp: "5511987654321",
  asaasCustomerId: null,
  active: true,
};
const balanceInput = {
  productId: "p1",
  deliveryAccessToken: "token-with-enough-characters-000000",
  paymentMethod: "balance",
};
const permission = (overrides: Partial<{ canUseBalanceAsPayment: boolean; customerTier: string; enabled: boolean; balanceCents: number }> = {}) => {
  const { canUseBalanceAsPayment = true, customerTier = "NORMAL", enabled = true, balanceCents = 5000 } = overrides;
  return { canUseBalanceAsPayment, customerTier, accountBalance: { enabled, balanceCents } };
};

describe("regra única de elegibilidade do pagamento por saldo", () => {
  const eligible = { customerTier: "NORMAL", canUseBalanceAsPayment: true, accountBalance: { enabled: true, balanceCents: 1200 } };

  it("permissão: flag do Admin ou PREMIUM_PLUS", () => {
    expect(hasBalancePaymentPermission({ customerTier: "NORMAL", canUseBalanceAsPayment: true })).toBe(true);
    expect(hasBalancePaymentPermission({ customerTier: "PREMIUM_PLUS", canUseBalanceAsPayment: false })).toBe(true);
    expect(hasBalancePaymentPermission({ customerTier: "PREMIUM", canUseBalanceAsPayment: false })).toBe(false);
  });

  it("a opção só existe com login, permissão, saldo habilitado e produto que não seja recarga", () => {
    expect(balancePaymentOption(eligible, "TOOL")).toEqual({ balanceCents: 1200 });
    expect(balancePaymentOption(null, "TOOL")).toBeNull();
    expect(balancePaymentOption({ ...eligible, canUseBalanceAsPayment: false }, "TOOL")).toBeNull();
    expect(balancePaymentOption({ ...eligible, accountBalance: { enabled: false, balanceCents: 1200 } }, "TOOL")).toBeNull();
    expect(balancePaymentOption({ ...eligible, accountBalance: null }, "TOOL")).toBeNull();
    expect(balancePaymentOption(eligible, "BALANCE_TOPUP")).toBeNull();
    expect(productAcceptsBalancePayment("BALANCE_TOPUP")).toBe(false);
  });

  it("PREMIUM_PLUS não depende da flag, mas ainda exige saldo habilitado", () => {
    const plus = { ...eligible, customerTier: "PREMIUM_PLUS", canUseBalanceAsPayment: false };
    expect(balancePaymentOption(plus, "TOOL")).toEqual({ balanceCents: 1200 });
    expect(balancePaymentOption({ ...plus, accountBalance: { enabled: false, balanceCents: 1200 } }, "TOOL")).toBeNull();
  });

  it("calcula quanto falta, nunca negativo", () => {
    expect(balanceShortfallCents(2500, 4000)).toBe(1500);
    expect(balanceShortfallCents(4000, 4000)).toBe(0);
    expect(balanceShortfallCents(9000, 4000)).toBe(0);
  });
});

describe("createOrder — pagamento por saldo", () => {
  let ledger: ReturnType<typeof createFakeLedgerDb>;

  beforeEach(() => {
    for (const model of Object.values(db))
      if (typeof model === "function") (model as ReturnType<typeof vi.fn>).mockReset();
      else for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
    createPixPayment.mockReset();
    executeFulfillment.mockReset();
    ledger = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    db.order.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ id: "o1", status: "PAID" });
    db.product.findFirst.mockResolvedValue(product());
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.user.findFirst.mockResolvedValue(account);
    db.user.findUnique.mockResolvedValue(permission());
    db.order.create.mockImplementation(async ({ data }: { data: { publicToken: string } }) => ({ id: "o1", publicToken: data.publicToken }));
    // A transação do saldo roda contra o ledger em memória (com rollback).
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      ledger.$transaction(() => fn({ ...ledger, order: { create: db.order.create } })),
    );
  });

  it("debita no ledger (PURCHASE, sourceOrderId = pedido) e dispara a entrega logo após o débito", async () => {
    const result = await createOrder(balanceInput, "u1");
    expect(result?.order).toMatchObject({ id: "o1", status: "PAID" });
    expect(ledger.state.entries).toEqual([
      expect.objectContaining({ type: "PURCHASE", amountCents: -1000, balanceAfterCents: 4000, sourceOrderId: "o1" }),
    ]);
    expect(ledger.state.balances[0].balanceCents).toBe(4000);
    expect(executeFulfillment).toHaveBeenCalledExactlyOnceWith("o1");
    expect(createPixPayment).not.toHaveBeenCalled();
  });

  it("falha na entrega não desfaz o pagamento: o pedido volta PAID e o erro vai para o log", async () => {
    executeFulfillment.mockRejectedValueOnce(new Error("provider down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await createOrder(balanceInput, "u1");
    expect(result?.order).toMatchObject({ id: "o1", status: "PAID" });
    expect(ledger.state.balances[0].balanceCents).toBe(4000);
    expect(error).toHaveBeenCalledWith(
      "[fulfillment] Execução falhou após pagamento por saldo.",
      expect.objectContaining({ orderId: "o1" }),
    );
    error.mockRestore();
  });

  it("reenvio com o mesmo token de um pedido pago com saldo devolve o pedido sem PIX, sem novo débito e sem nova entrega", async () => {
    db.order.findUnique.mockReset();
    db.order.findUnique
      .mockResolvedValueOnce({ id: "o1", status: "PAID", payment: { provider: "balance" } })
      .mockResolvedValue({ id: "o1", status: "PAID" });
    const result = await createOrder(balanceInput, "u1");
    expect(result?.order).toMatchObject({ id: "o1" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(createPixPayment).not.toHaveBeenCalled();
    expect(executeFulfillment).not.toHaveBeenCalled();
    expect(ledger.state.entries).toHaveLength(0);
  });

  it("reenvio de pedido PIX ativo continua indo para a retomada do PIX (caminho inalterado)", async () => {
    db.order.findUnique.mockReset();
    db.order.findUnique
      .mockResolvedValueOnce({ id: "o9", status: "PENDING_PAYMENT", payment: { provider: "mock" } })
      // retryPendingPixCheckout: PIX já gerado, nada a refazer.
      .mockResolvedValueOnce({ id: "o9", payment: { pixCode: "pix", qrCode: "qr" }, customer: account })
      .mockResolvedValue({ id: "o9", status: "PENDING_PAYMENT" });
    const result = await createOrder({ ...balanceInput, paymentMethod: "pix" }, "u1");
    expect(result?.order).toMatchObject({ id: "o9" });
    expect(db.order.findUnique).toHaveBeenNthCalledWith(2, { where: { id: "o9" }, include: { payment: true, customer: true } });
  });

  it("recarga de saldo não pode ser paga com saldo: bloqueia antes de criar o pedido", async () => {
    db.product.findFirst.mockResolvedValue(product("BALANCE_TOPUP"));
    db.accountBalance.findUnique.mockResolvedValue({ enabled: true });
    await expect(createOrder(balanceInput, "u1")).rejects.toThrow("BALANCE_PAYMENT_NOT_ALLOWED");
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("saldo desabilitado é recusado já na validação prévia, antes de criar o pedido", async () => {
    db.user.findUnique.mockResolvedValue(permission({ enabled: false }));
    await expect(createOrder(balanceInput, "u1")).rejects.toThrow("BALANCE_NOT_ENABLED");
    expect(db.order.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("sem permissão e com saldo insuficiente continuam recusados antes de criar o pedido", async () => {
    db.user.findUnique.mockResolvedValueOnce(permission({ canUseBalanceAsPayment: false }));
    await expect(createOrder(balanceInput, "u1")).rejects.toThrow("BALANCE_PERMISSION_REQUIRED");
    db.order.findUnique.mockResolvedValueOnce(null);
    db.user.findUnique.mockResolvedValueOnce(permission({ balanceCents: 999 }));
    await expect(createOrder(balanceInput, "u1")).rejects.toThrow("INSUFFICIENT_BALANCE");
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it("PREMIUM_PLUS paga com saldo mesmo sem a flag do Admin", async () => {
    db.user.findUnique.mockResolvedValue(permission({ canUseBalanceAsPayment: false, customerTier: "PREMIUM_PLUS" }));
    await createOrder(balanceInput, "u1");
    expect(ledger.state.entries).toHaveLength(1);
  });
});

describe("respostas de erro do pagamento por saldo", () => {
  it("a rota traduz BALANCE_PAYMENT_NOT_ALLOWED em 422 com código claro", async () => {
    const request = new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(balanceInput),
    });
    const response = await handleCheckoutRequest(request, async () => {
      throw new Error("BALANCE_PAYMENT_NOT_ALLOWED");
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: "BALANCE_PAYMENT_NOT_ALLOWED" });
  });

  it("no envio por saldo o painel mostra o texto do servidor; no PIX as mensagens não mudam", () => {
    const payload = { ok: false, code: "BALANCE_NOT_ENABLED", error: "O uso de saldo ainda não está habilitado." };
    expect(checkoutErrorMessage(403, payload, "balance")).toBe(payload.error);
    expect(checkoutErrorMessage(403, payload)).toBe(CHECKOUT_FALLBACK_ERROR);
    expect(checkoutErrorMessage(403, payload, "pix")).toBe(CHECKOUT_FALLBACK_ERROR);
    expect(checkoutErrorMessage(500, null, "balance")).toBe(BALANCE_CHECKOUT_FALLBACK_ERROR);
    expect(checkoutErrorMessage(500, null)).toBe(CHECKOUT_FALLBACK_ERROR);
  });
});

describe("painel de checkout — opção de saldo ao lado do PIX", () => {
  const source = readFileSync(path.resolve(__dirname, "../components/checkout-panel.tsx"), "utf8");

  it("mantém o botão e os rótulos do PIX", () => {
    expect(source).toContain('"COMPRAR COM PIX"');
    expect(source).toContain("<>▣ GERAR PIX</>");
    expect(source).toContain('"GERANDO PIX..."');
  });

  it("o botão de saldo tem a mesma classe base do botão PIX (mesmo peso visual)", () => {
    expect(source).toContain('className="product-buy product-buy--balance"');
    expect(source).toContain("PAGAR COM SALDO");
  });

  it("só envia paymentMethod quando o saldo está escolhido: o corpo do PIX fica como era", () => {
    expect(source).toContain('...(payingWithBalance ? { paymentMethod: "balance" } : {}),');
    expect(source.match(/paymentMethod: "balance"/g)).toHaveLength(1);
  });

  it("a opção de saldo só é renderizada quando o servidor a forneceu", () => {
    expect(source).toContain("{balancePayment && product.available && (");
    expect(source).toContain("{balancePayment && (\n                    <fieldset");
    expect(source).toContain('const payingWithBalance = paymentMethod === "balance" && balancePayment !== null;');
  });
});
