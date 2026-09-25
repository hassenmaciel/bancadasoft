import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  accountBalance: { findUnique: vi.fn() },
  accountLedgerEntry: { findMany: vi.fn() },
  product: { findFirst: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { LEDGER_PAGE_SIZE, ledgerTypeLabel, loadCustomerBalance, signedBRL, topupHref } from "./customer-balance";
import { initialCheckoutVariantId } from "./product-variants";

const user = { id: "u1", customerTier: "NORMAL" as const };
const readyProvider = { active: true, mode: "REAL", technicalEligibility: "READY", fieldSchema: [], provider: { active: true, code: "internal-balance" } };
const variant = (id: string, name: string, priceCents: number, sortOrder: number, extra: Record<string, unknown> = {}) => ({
  id, name, sortOrder, priceCents, active: true, publicationBlocked: false, providerProduct: readyProvider, ...extra,
});
const topupProduct = {
  id: "p-topup",
  slug: "recarga-de-saldo",
  name: "Recarga de Saldo",
  type: "BALANCE_TOPUP",
  status: "PUBLISHED",
  available: true,
  priceCents: 5000,
  priceVisibility: "LOGIN_REQUIRED",
  category: null,
  brand: null,
  providerProducts: [],
  variants: [
    variant("v100", "R$ 100", 10000, 2),
    variant("v50", "R$ 50", 5000, 1),
    variant("v-off", "Inativa", 20000, 3, { active: false }),
  ],
};

describe("loadCustomerBalance", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
    db.accountLedgerEntry.findMany.mockResolvedValue([]);
    db.product.findFirst.mockResolvedValue(topupProduct);
  });

  it("mostra o saldo quando habilitado e lista só os pacotes ativos, na ordem, apontando para produto/variante", async () => {
    db.accountBalance.findUnique.mockResolvedValue({ balanceCents: 12345, enabled: true });
    const view = await loadCustomerBalance(user);
    expect(view.enabled).toBe(true);
    expect(view.balanceCents).toBe(12345);
    expect(view.topupOptions).toEqual([
      { key: "v50", label: "R$ 50", priceCents: 5000, href: "/produto/recarga-de-saldo?variante=v50" },
      { key: "v100", label: "R$ 100", priceCents: 10000, href: "/produto/recarga-de-saldo?variante=v100" },
    ]);
    expect(db.product.findFirst.mock.calls[0][0].where).toMatchObject({ type: "BALANCE_TOPUP", status: "PUBLISHED", available: true });
  });

  it("desabilitado ou sem linha: não expõe saldo nem oferece recarga", async () => {
    db.accountBalance.findUnique.mockResolvedValue({ balanceCents: 999, enabled: false });
    expect(await loadCustomerBalance(user)).toMatchObject({ enabled: false, balanceCents: null, topupOptions: [] });
    db.accountBalance.findUnique.mockResolvedValue(null);
    expect(await loadCustomerBalance(user)).toMatchObject({ enabled: false, balanceCents: null, topupOptions: [] });
    expect(db.product.findFirst).not.toHaveBeenCalled();
  });

  it("busca só os últimos 20 lançamentos do próprio usuário, sem campos internos", async () => {
    db.accountBalance.findUnique.mockResolvedValue(null);
    await loadCustomerBalance(user);
    const query = db.accountLedgerEntry.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: "u1" });
    expect(query.take).toBe(LEDGER_PAGE_SIZE);
    expect(LEDGER_PAGE_SIZE).toBe(20);
    expect(query.orderBy).toEqual({ createdAt: "desc" });
    expect(Object.keys(query.select).sort()).toEqual(["amountCents", "balanceAfterCents", "createdAt", "id", "type"]);
  });

  it("sem produto de recarga publicado, não oferece pacotes", async () => {
    db.accountBalance.findUnique.mockResolvedValue({ balanceCents: 0, enabled: true });
    db.product.findFirst.mockResolvedValue(null);
    expect((await loadCustomerBalance(user)).topupOptions).toEqual([]);
  });
});

describe("formatação e links", () => {
  it("traduz os tipos do extrato", () => {
    expect(ledgerTypeLabel).toEqual({ TOPUP: "Recarga", PURCHASE: "Compra", REFUND: "Estorno", ADJUSTMENT: "Ajuste" });
  });
  it("valor com sinal", () => {
    expect(signedBRL(5000).replace(/\s/g, " ")).toBe("+R$ 50,00");
    expect(signedBRL(-1990).replace(/\s/g, " ")).toBe("-R$ 19,90");
  });
  it("link de recarga", () => {
    expect(topupHref("recarga-de-saldo", "v50")).toBe("/produto/recarga-de-saldo?variante=v50");
    expect(topupHref("recarga-de-saldo")).toBe("/produto/recarga-de-saldo");
  });
  it("checkout pré-seleciona a variante pedida só se ela for oferecida", () => {
    const variants = [{ id: "v50", priceCents: 5000 }, { id: "v100", priceCents: 10000 }];
    expect(initialCheckoutVariantId(variants, "v100")).toBe("v100");
    expect(initialCheckoutVariantId(variants, "outra")).toBe("");
    expect(initialCheckoutVariantId(variants, null)).toBe("");
    expect(initialCheckoutVariantId([{ id: "v50", priceCents: 5000 }], "outra")).toBe("v50");
  });
});
