import { describe, expect, it } from "vitest";
import {
  CONFIRM_ENV,
  PLAN,
  PLAN_SLUGS,
  buildProductData,
  preconditionProblems,
  resolveMode,
  revertSql,
} from "./implement-adclean-license-split.mjs";

const pp = (externalProductId, id, productId = null) => ({ id, externalProductId, productId });
const okState = () => ({
  old: {
    id: "old",
    status: "DRAFT",
    available: false,
    providerProductsCount: 0,
    variants: [
      { id: "v1", code: "12h", providerProductId: "pp-12" },
      { id: "v2", code: "6-meses", providerProductId: "pp-4320" },
      { id: "v3", code: "1-ano", providerProductId: "pp-8760" },
    ],
  },
  providerProducts: [pp("licenca-12h", "pp-12"), pp("licenca-4320h", "pp-4320"), pp("licenca-8760h", "pp-8760")],
  existingSlugs: [],
  category: { id: "cat", active: true },
  references: { "OrderItem da ficha antiga (productId)": 0, "ProviderOrder dos ProviderProducts da licença": 0 },
});

describe("split da Licença AdClean em 3 Products", () => {
  it("um Product por período, ligado ao seu ProviderProduct", () => {
    expect(PLAN.map((item) => [item.slug, item.externalId])).toEqual([
      ["adclean-licenca-12h", "licenca-12h"],
      ["adclean-licenca-6-meses", "licenca-4320h"],
      ["adclean-licenca-1-ano", "licenca-8760h"],
    ]);
  });

  it("cada Product nasce DRAFT, indisponível, sem preço de venda nem de revenda", () => {
    for (const item of PLAN) {
      expect(buildProductData(item.period, "cat")).toMatchObject({
        slug: item.slug,
        status: "DRAFT",
        available: false,
        featured: false,
        manualPriceCents: null,
        resellerPriceCents: null,
        pricingStatus: "NEEDS_REVIEW",
        categoryId: "cat",
      });
    }
    expect(PLAN.map((item) => buildProductData(item.period, "cat").sortOrder)).toEqual([30, 20, 10]);
  });

  it("pré-condições OK no estado esperado", () => {
    expect(preconditionProblems(okState())).toEqual([]);
  });

  it("recusa quando há qualquer referência (pedido/ProviderOrder), ficha publicada ou slug ocupado", () => {
    const withOrder = okState();
    withOrder.references["OrderItem da ficha antiga (productId)"] = 1;
    expect(preconditionProblems(withOrder).join()).toMatch(/OrderItem da ficha antiga/);

    const published = okState();
    published.old.status = "PUBLISHED";
    expect(preconditionProblems(published).join()).toMatch(/status=PUBLISHED/);

    const taken = okState();
    taken.existingSlugs = [{ id: "x", slug: PLAN_SLUGS[0] }];
    expect(preconditionProblems(taken).join()).toMatch(/já existe/);

    const linked = okState();
    linked.providerProducts[0].productId = "outro";
    expect(preconditionProblems(linked).join()).toMatch(/já tem productId/);

    const swapped = okState();
    swapped.old.variants[0].providerProductId = "pp-8760";
    swapped.old.variants[2].providerProductId = "pp-12";
    expect(preconditionProblems(swapped).length).toBeGreaterThan(0);

    expect(preconditionProblems({ ...okState(), old: null }).join()).toMatch(/não encontrado/);
  });

  it("--apply exige a confirmação explícita", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(() => resolveMode(["--apply"], {})).toThrow(CONFIRM_ENV);
    expect(resolveMode(["--apply"], { [CONFIRM_ENV]: "SIM" })).toBe("APPLY");
  });

  it("reversão só desvincula e apaga os 3 Products DRAFT sem pedido", () => {
    const sql = revertSql();
    for (const slug of PLAN_SLUGS) expect(sql).toContain(`'${slug}'`);
    expect(sql).toContain("status = 'DRAFT'");
    expect(sql).toContain("NOT EXISTS");
  });
});
