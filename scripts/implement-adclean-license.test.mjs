import { describe, expect, it } from "vitest";
import {
  CATEGORY_SLUG,
  CONFIRM_ENV,
  PERIODS,
  PRODUCT,
  PROVIDER,
  preconditionProblems,
  providerProductData,
  resolveMode,
  revertSql,
  variantData,
} from "./implement-adclean-license.mjs";

describe("plano da Licença AdClean (revenda)", () => {
  it("provider próprio adclean-license, nasce inativo e NOT_CONNECTED", () => {
    expect(PROVIDER).toMatchObject({ code: "adclean-license", active: false, integrationStatus: "NOT_CONNECTED" });
  });

  it("3 períodos 12h / 6 meses / 1 ano com periodo_horas no metadata", () => {
    expect(PERIODS.map((p) => p.periodoHoras)).toEqual([12, 4320, 8760]);
    for (const period of PERIODS) {
      const pp = providerProductData(period, "prov");
      expect(pp).toMatchObject({
        providerId: "prov",
        productId: null,
        externalProductId: period.externalId,
        mode: "REAL",
        expectedDeliveryType: "CODE",
      });
      expect(pp.metadata).toEqual({ periodo_horas: period.periodoHoras });
    }
  });

  it("Product TOOL nasce DRAFT e indisponível", () => {
    expect(PRODUCT).toMatchObject({ type: "TOOL", status: "DRAFT", available: false });
  });

  it("variantes ficam bloqueadas até o preço ser definido", () => {
    for (const period of PERIODS)
      expect(variantData(period, "prod", "pp")).toMatchObject({
        productId: "prod",
        providerProductId: "pp",
        code: period.code,
        priceCents: null,
        publicationBlocked: true,
      });
  });

  it("pré-condições: aborta se qualquer peça já existir ou se a categoria faltar", () => {
    const clean = { provider: null, providerProducts: [], product: null, category: { id: "c", active: true } };
    expect(preconditionProblems(clean)).toEqual([]);
    expect(preconditionProblems({ ...clean, provider: { id: "x" } })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, providerProducts: [{ id: "y", externalProductId: "licenca-12h" }] })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, product: { id: "z" } })).toHaveLength(1);
    expect(preconditionProblems({ ...clean, category: null })).toEqual([`Categoria "${CATEGORY_SLUG}" não encontrada`]);
    expect(preconditionProblems({ ...clean, category: { id: "c", active: false } })).toHaveLength(1);
  });

  it("dry-run por padrão; --apply só com a confirmação explícita", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(resolveMode([], { [CONFIRM_ENV]: "SIM" })).toBe("DRY_RUN");
    expect(() => resolveMode(["--apply"], {})).toThrow(CONFIRM_ENV);
    expect(() => resolveMode(["--apply"], { [CONFIRM_ENV]: "sim" })).toThrow();
    expect(resolveMode(["--apply"], { [CONFIRM_ENV]: "SIM" })).toBe("APPLY");
  });

  it("SQL de reversão só mira as peças do plano", () => {
    const sql = revertSql();
    expect(sql).toContain("'adclean-licenca'");
    expect(sql).toContain("'adclean-license'");
    expect(sql).not.toContain("code = 'adclean'");
  });
});
