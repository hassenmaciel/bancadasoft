import { describe, expect, it } from "vitest";
import { CONFIRM_ENV, EXTERNAL_ID, MIN_CENTS, plan, providerProductData, resolveMode, revertSql, variantData } from "./seed-topup-free-amount.mjs";

const ready = (extra = {}) => ({
  provider: { id: "prov", active: true },
  product: { id: "prod", type: "BALANCE_TOPUP" },
  providerProduct: null,
  maxSortOrder: 3,
  ...extra,
});

describe("seed do pacote 'Outro valor' (O2)", () => {
  it("ProviderProduct interno com freeAmount e sem creditAmountCents", () => {
    const pp = providerProductData("prov");
    expect(pp).toMatchObject({ providerId: "prov", productId: null, externalProductId: EXTERNAL_ID, mode: "REAL", technicalEligibility: "READY", active: true });
    expect(pp.metadata).toEqual({ freeAmount: true });
  });

  it("variante 'Outro valor' ativa, ao final da lista, com preço gravado = mínimo de R$ 15,00", () => {
    expect(MIN_CENTS).toBe(1500);
    expect(variantData("prod", "pp", 4)).toMatchObject({
      productId: "prod", providerProductId: "pp", name: "Outro valor", code: "recarga-outro-valor", active: true, sortOrder: 4,
      priceCents: 1500, normalPriceCents: 1500, manualPriceCents: 1500, publicationBlocked: false,
    });
  });

  it("cria só quando ainda não existe", () => {
    expect(plan(ready())).toEqual({ problems: [], action: "CREATE" });
  });

  it("idempotente: já existe com os dados esperados → nada a fazer", () => {
    const existing = { id: "pp", metadata: { freeAmount: true }, variants: [{ id: "v", productId: "prod" }] };
    expect(plan(ready({ providerProduct: existing }))).toEqual({ problems: [], action: "NOTHING" });
  });

  it("aborta sem escrever quando algo não confere", () => {
    expect(plan(ready({ provider: null })).problems).toContain('Provider "internal-balance" não encontrado');
    expect(plan(ready({ product: { id: "prod", type: "TOOL" } })).problems[0]).toMatch(/não é BALANCE_TOPUP/);
    const wrongMeta = { id: "pp", metadata: { freeAmount: true, creditAmountCents: 1000 }, variants: [{ id: "v", productId: "prod" }] };
    expect(plan(ready({ providerProduct: wrongMeta })).problems[0]).toMatch(/metadata inesperado/);
    const noVariant = { id: "pp", metadata: { freeAmount: true }, variants: [] };
    expect(plan(ready({ providerProduct: noVariant })).problems[0]).toMatch(/sem variante/);
  });

  it("SQL de reversão só toca o pacote 'Outro valor'", () => {
    const sql = revertSql();
    expect(sql).toContain("code = 'recarga-outro-valor'");
    expect(sql).toContain(`"externalProductId" = '${EXTERNAL_ID}'`);
    expect(sql).not.toMatch(/topup-1000|topup-3000|topup-5000/);
  });

  it("--apply exige confirmação explícita; padrão é DRY_RUN", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(() => resolveMode(["--apply"], {})).toThrow(CONFIRM_ENV);
    expect(resolveMode(["--apply"], { [CONFIRM_ENV]: "SIM" })).toBe("APPLY");
  });
});
