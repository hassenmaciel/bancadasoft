import { describe, expect, it } from "vitest";
import {
  CATEGORY_SLUG,
  PACKAGES,
  PRODUCT,
  PROVIDER,
  preconditionProblems,
  providerProductData,
  revertSql,
  simulateResolution,
  variantData,
} from "./implement-balance-topup.mjs";

describe("plano da Recarga de Saldo", () => {
  it("provider interno próprio (nunca mock-sandbox), ativo e CONNECTED", () => {
    expect(PROVIDER).toEqual({ code: "internal-balance", name: "Saldo BancadaSoft (interno)", active: true, integrationStatus: "CONNECTED" });
  });

  it("3 pacotes R$10/R$30/R$50 com creditAmountCents no metadata do ProviderProduct", () => {
    expect(PACKAGES.map((p) => p.creditAmountCents)).toEqual([1000, 3000, 5000]);
    for (const pkg of PACKAGES) {
      const pp = providerProductData(pkg, "prov");
      expect(pp).toMatchObject({ providerId: "prov", productId: null, externalProductId: pkg.externalId, mode: "REAL", technicalEligibility: "READY", expectedDeliveryType: "TEXT" });
      expect(pp.metadata).toEqual({ creditAmountCents: pkg.creditAmountCents });
    }
  });

  it("Product BALANCE_TOPUP nasce DRAFT, indisponível e com login obrigatório", () => {
    expect(PRODUCT).toMatchObject({ type: "BALANCE_TOPUP", status: "DRAFT", available: false, priceVisibility: "LOGIN_REQUIRED", pricingMode: "MANUAL" });
  });

  it("variantes com preço = valor creditado e sem preço por nível", () => {
    for (const pkg of PACKAGES)
      expect(variantData(pkg, "prod", "pp")).toMatchObject({
        priceCents: pkg.creditAmountCents,
        manualPriceCents: pkg.creditAmountCents,
        normalPriceCents: null,
        premiumPriceCents: null,
        pricingMode: "MANUAL",
        publicationBlocked: false,
      });
  });

  it("pré-condições: aborta se qualquer peça já existir ou se a categoria faltar", () => {
    const clean = { provider: null, providerProducts: [], product: null, category: { id: "c", active: true } };
    expect(preconditionProblems(clean)).toEqual([]);
    expect(preconditionProblems({ ...clean, provider: { id: "x" } })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, providerProducts: [{ id: "y", externalProductId: "topup-1000" }] })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, product: { id: "z" } })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, category: null })).toEqual([`Categoria "${CATEGORY_SLUG}" não encontrada`]);
    expect(preconditionProblems({ ...clean, category: { id: "c", active: false } })).toHaveLength(1);
  });

  it("simulação: SELECTED no modo REAL; o provider interno não é tratado como sandbox", () => {
    expect(simulateResolution(PACKAGES[0], "REAL")).toBe("SELECTED");
    expect(simulateResolution(PACKAGES[0], "TEST")).toBe("MISSING");
  });

  it("SQL de reversão só mira as peças do plano", () => {
    expect(revertSql()).toContain("'recarga-de-saldo'");
    expect(revertSql()).toContain("'internal-balance'");
  });
});
