import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCheckoutVariant } from "../src/lib/product-variants";
import { resolveProviderProduct } from "../src/lib/providers/selection";
import {
  buildPlan,
  buildProductData,
  longDescriptionFor,
  PLAN_EXTERNAL_IDS,
  PLAN_SLUGS,
  providerProductProblems,
  resolveMode,
  revertSql,
  scanPublicProductQueries,
  searchTermsFor,
  simulateNewProductResolution,
} from "./implement-unlocktool-license-split.mjs";

const ids = { brandId: "brand-1", categoryId: "cat-1" };
const fieldSchema = [
  { key: "email", customerVisible: true },
  { key: "username", customerVisible: true },
];
const providerProduct = (overrides = {}) => ({
  id: "pp-1",
  productId: null,
  externalProductId: "4662",
  active: true,
  mode: "REAL",
  providerCostCents: 1595,
  technicalEligibility: "READY",
  automationClass: "AUTO_FIELD_BASED",
  expectedDeliveryType: "LICENSE",
  fieldSchema,
  provider: { id: "prov-1", code: "heartunlocks", active: true },
  ...overrides,
});

describe("plano de Products", () => {
  const plan = buildPlan(ids);
  it("cria 3 Products com slug, ProviderProduct e preço da especificação", () => {
    expect(plan.map((p) => [p.data.slug, p.externalId, p.data.priceCents])).toEqual([
      ["unlocktool-licenca-3-meses", "4662", 15500],
      ["unlocktool-licenca-6-meses", "4661", 21000],
      ["unlocktool-licenca-12-meses", "4663", 31000],
    ]);
    expect(PLAN_SLUGS).toEqual(plan.map((p) => p.data.slug));
    expect(PLAN_EXTERNAL_IDS).toEqual(["4662", "4661", "4663"]);
  });
  it("todos nascem DRAFT, indisponíveis, sem imagem, sem destaque, MANUAL, LICENSE/AUTOMATIC", () => {
    for (const { data } of plan) {
      expect(data).toMatchObject({
        status: "DRAFT",
        available: false,
        imageUrl: null,
        featured: false,
        type: "LICENSE",
        deliveryType: "AUTOMATIC",
        pricingMode: "MANUAL",
        pricingStatus: "MANUAL",
        deliveryEstimate: "1 a 24 horas",
        brandId: "brand-1",
        categoryId: "cat-1",
        premiumPriceCents: null,
        priceVisibility: "PUBLIC",
      });
    }
  });
  it("espelha o unlocktool-6h: priceCents = normalPriceCents = manualPriceCents (o checkout cobra normalPriceCents)", () => {
    for (const { data } of plan) {
      expect(data.normalPriceCents).toBe(data.priceCents);
      expect(data.manualPriceCents).toBe(data.priceCents);
    }
  });
  it("textos por duração", () => {
    const three = buildProductData({ months: 3, priceCents: 15500 }, ids);
    expect(three.name).toBe("UnlockTool — Licença 3 meses");
    expect(three.description).toBe("UnlockTool 3 months License · Active/Renew");
    expect(three.duration).toBe("3 meses (ativação/renovação)");
    expect(buildProductData({ months: 12, priceCents: 31000 }, ids).duration).toBe("12 meses (ativação/renovação)");
    expect(searchTermsFor(6)).toBe("unlocktool licença ativação renovação utool active renew 6 meses");
    const long = longDescriptionFor(3);
    expect(long).not.toContain("\n");
    expect(long.startsWith("Ativa ou renova a licença UnlockTool de 3 meses na sua conta UnlockTool.")).toBe(true);
    expect(long.endsWith("Confira o usuário com atenção: a ativação não pode ser desfeita.")).toBe(true);
    expect(longDescriptionFor(12)).toContain("de 12 meses");
  });
});

describe("modo de execução", () => {
  it("padrão é DRY-RUN", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(resolveMode([], { CONFIRM_UNLOCKTOOL_SPLIT: "SIM" })).toBe("DRY_RUN");
  });
  it("--apply sem confirmação é recusado", () => {
    expect(() => resolveMode(["--apply"], {})).toThrow(/CONFIRM_UNLOCKTOOL_SPLIT=SIM/);
    expect(() => resolveMode(["--apply"], { CONFIRM_UNLOCKTOOL_SPLIT: "sim" })).toThrow();
    expect(() => resolveMode(["--apply"], { CONFIRM_UNLOCKTOOL_SPLIT: "1" })).toThrow();
  });
  it("--apply + CONFIRM=SIM libera a escrita", () => {
    expect(resolveMode(["--apply"], { CONFIRM_UNLOCKTOOL_SPLIT: "SIM" })).toBe("APPLY");
  });
  it("o script trata --execute (padrão dos outros scripts) como dry-run", () => {
    expect(resolveMode(["--execute"], { CONFIRM_UNLOCKTOOL_SPLIT: "SIM" })).toBe("DRY_RUN");
  });
});

describe("elegibilidade do ProviderProduct", () => {
  it("aceita 4661/4662/4663 no estado atual", () => {
    expect(providerProductProblems(providerProduct())).toEqual([]);
  });
  it.each([
    ["productId preenchido", { productId: "x" }],
    ["inativo", { active: false }],
    ["modo TEST", { mode: "TEST" }],
    ["technicalEligibility REVIEW", { technicalEligibility: "REVIEW" }],
    ["provider inativo", { provider: { id: "p", code: "heartunlocks", active: false } }],
    ["outro provider", { provider: { id: "p", code: "adclean", active: true } }],
    ["campo extra visível", { fieldSchema: [...fieldSchema, { key: "notes", customerVisible: true }] }],
    ["entrega não é LICENSE", { expectedDeliveryType: "CREDENTIALS" }],
  ])("recusa: %s", (_label, override) => {
    expect(providerProductProblems(providerProduct(override)).length).toBeGreaterThan(0);
  });
  it("recusa ProviderProduct inexistente", () => {
    expect(providerProductProblems(undefined)).toEqual(["ProviderProduct não encontrado"]);
  });
});

describe("resolução do checkout", () => {
  it("Product novo com vínculo direto: exatamente 1 elegível (SELECTED)", () => {
    const sim = simulateNewProductResolution(providerProduct(), "new-product", "REAL");
    expect(sim).toEqual({ status: "SELECTED", selectedId: "pp-1", eligibleCount: 1 });
  });
  it("dois vínculos elegíveis no mesmo Product seriam AMBIGUOUS (o que o plano evita: 1 por Product)", () => {
    const a = providerProduct({ id: "pp-a", productId: "p" });
    const b = providerProduct({ id: "pp-b", externalProductId: "4661", productId: "p" });
    expect(resolveProviderProduct([a, b], "REAL").status).toBe("AMBIGUOUS");
  });
  it("ficha antiga continua pela variante mesmo com o ProviderProduct ganhando productId de outro Product", () => {
    const linked = providerProduct({ productId: "new-product" });
    const variant = {
      id: "variant-1",
      name: "3 meses",
      code: "3-meses",
      active: true,
      sortOrder: 0,
      priceCents: 15500,
      normalPriceCents: 15500,
      publicationBlocked: false,
      providerProduct: linked,
    };
    const result = resolveCheckoutVariant([variant], "variant-1", "REAL");
    expect(result?.status).toBe("SELECTED");
    expect(result?.providerProduct?.id).toBe("pp-1");
    expect(resolveCheckoutVariant([variant], undefined, "REAL")?.status).toBe("VARIANT_REQUIRED");
  });
});

describe("reversão", () => {
  const sql = revertSql();
  it("desvincula antes de apagar e só apaga DRAFT sem OrderItem", () => {
    expect(sql.indexOf('UPDATE "ProviderProduct"')).toBeLessThan(sql.indexOf('DELETE FROM "Product"'));
    expect(sql).toContain("status = 'DRAFT'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "OrderItem"');
  });
  it("não altera nenhuma tabela de pedido, pagamento ou fulfillment", () => {
    expect(sql).not.toMatch(/(UPDATE|DELETE FROM|INSERT INTO)\s+"(Order|OrderItem|Payment|Fulfillment|ProviderOrder|PaymentEvent|OrderEvent)"/);
  });
});

describe("script", () => {
  it("as escritas ficam restritas a Product.create e ProviderProduct.updateMany (produtos novos)", () => {
    const source = readFileSync(new URL("./implement-unlocktool-license-split.mjs", import.meta.url), "utf8");
    const writes = [...source.matchAll(/\b(?:tx|db|prisma)\.(\w+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\(/g)].map((m) => `${m[1]}.${m[2]}`);
    expect([...new Set(writes)].sort()).toEqual(["product.create", "providerProduct.updateMany"]);
  });
  it("a varredura estática só deixa sem filtro o productsForAdmin (sem uso)", () => {
    const unguarded = scanPublicProductQueries().filter((row) => !row.guarded);
    expect(unguarded.map((row) => row.file)).toEqual(["src/lib/commerce.ts"]);
    const commerce = readFileSync(new URL("../src/lib/commerce.ts", import.meta.url), "utf8").split("\n");
    expect(commerce[unguarded[0].line - 1]).toContain("prisma.product.findMany");
    expect(commerce[unguarded[0].line - 2]).toContain("productsForAdmin");
  });
});
