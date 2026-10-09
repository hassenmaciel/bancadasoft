import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCheckoutVariant } from "../src/lib/product-variants";
import {
  buildPlan,
  buildProductData,
  configPathFrom,
  DEFAULT_PLAN,
  loadPlan,
  PLAN_EXTERNAL_IDS,
  PLAN_SLUGS,
  providerProductProblems,
  resolveMode,
  revertSql,
  simulateNewProductResolution,
  snapshotDiff,
  sourceVariantProblems,
  SPECS,
} from "./implement-frpfile-split.mjs";

const old = {
  slug: "frpfile-ramdisk-passcode-disabled",
  type: "IMEI_SN",
  deliveryType: "AUTOMATIC",
  deliveryEstimate: "1–24 horas",
  searchTerms: "frpfile ramdisk",
  priceVisibility: "LOGIN_REQUIRED",
  imageUrl: "https://img/x.webp",
  categoryId: "cat-1",
  brandId: "brand-1",
  variants: [{ id: "v-4401", code: "a13-com-sinal", active: true, priceCents: 3999, premiumPriceCents: 3200, providerProductId: "pp-4401" }],
};
const spec = SPECS.find((s) => s.externalId === "4401");
const pp = (overrides = {}) => ({
  id: "pp-4401",
  productId: null,
  externalProductId: "4401",
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  automationClass: "AUTO_FIELD_BASED",
  expectedDeliveryType: "CODE",
  fieldSchema: [{ key: "ecid", customerVisible: true }],
  provider: { id: "prov-1", code: "heartunlocks", active: true },
  ...overrides,
});

describe("plano", () => {
  it("5 Products, um por ProviderProduct, slugs únicos", () => {
    expect(PLAN_EXTERNAL_IDS).toEqual(["223", "4400", "4401", "3126", "3128"]);
    expect(new Set(PLAN_SLUGS).size).toBe(5);
  });
  it("nomes e legendas públicos sem o texto técnico do fornecedor", () => {
    for (const s of SPECS) {
      for (const text of [s.name, s.description]) expect(text).not.toMatch(/without|Hidden Account|Read Owner|Service, Notification|To M3/);
    }
  });
  it("copia preço da variante e nasce DRAFT/indisponível em MANUAL", () => {
    const data = buildProductData(spec, old, old.variants[0]);
    expect(data).toMatchObject({
      priceCents: 3999, normalPriceCents: 3999, manualPriceCents: 3999, premiumPriceCents: 3200,
      pricingMode: "MANUAL", status: "DRAFT", available: false, categoryId: "cat-1", brandId: "brand-1",
      priceVisibility: "LOGIN_REQUIRED", type: "IMEI_SN",
    });
  });
});

describe("modo de execução", () => {
  it("padrão é DRY-RUN; --apply exige confirmação", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(() => resolveMode(["--apply"], {})).toThrow(/CONFIRM_FRPFILE_SPLIT/);
    expect(resolveMode(["--apply"], { CONFIRM_FRPFILE_SPLIT: "SIM" })).toBe("APPLY");
  });
});

describe("verificações", () => {
  it("aceita o ProviderProduct no estado atual e recusa já vinculado ou campo diferente", () => {
    expect(providerProductProblems(pp(), spec)).toEqual([]);
    expect(providerProductProblems(pp({ productId: "x" }), spec)).toHaveLength(1);
    expect(providerProductProblems(pp({ fieldSchema: [{ key: "serial", customerVisible: true }] }), spec)).toHaveLength(1);
  });
  it("variante de origem precisa estar ativa, com preço e apontando para o PP", () => {
    expect(sourceVariantProblems(old, spec, pp())).toEqual([]);
    expect(sourceVariantProblems(old, spec, pp({ id: "outro" }))).toHaveLength(1);
  });
  it("Product novo resolve SELECTED; ficha antiga continua pela variante", () => {
    expect(simulateNewProductResolution(pp(), "novo", "REAL").status).toBe("SELECTED");
    const variant = { ...old.variants[0], providerProduct: pp({ productId: "novo" }) };
    expect(resolveCheckoutVariant([variant], "v-4401", "REAL")?.status).toBe("SELECTED");
  });
  it("qualquer mudança no snapshot de pedidos/variantes aborta", () => {
    const snap = { variants: [{ id: "v", active: true, orderItems: 3, providerOrders: 3 }], orderItemsTotal: 62 };
    expect(snapshotDiff(snap, structuredClone(snap))).toBeNull();
    expect(snapshotDiff(snap, { ...snap, variants: [{ ...snap.variants[0], active: false }] })).not.toBeNull();
    expect(snapshotDiff(snap, { ...snap, orderItemsTotal: 61 })).not.toBeNull();
  });
  it("reversão só apaga DRAFT sem OrderItem e não toca em tabelas de pedido", () => {
    const sql = revertSql();
    expect(sql).toMatch(/status = 'DRAFT'/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM "OrderItem"/);
    expect(sql).not.toMatch(/(UPDATE|DELETE FROM) "(Order|OrderItem|Payment|Fulfillment|ProviderOrder|ProductVariant)"/);
  });
});

describe("plano por --config", () => {
  const helloPath = fileURLToPath(new URL("./frpfile-split/ramdisk-hello-wifi.json", import.meta.url));

  it("sem --config usa o plano original das 5 fichas", () => {
    expect(loadPlan([])).toBe(DEFAULT_PLAN);
    expect(loadPlan(["--apply"]).externalIds).toEqual(["223", "4400", "4401", "3126", "3128"]);
    expect(DEFAULT_PLAN.oldSlugs).toEqual(["frpfile-ramdisk-passcode-disabled", "frpfile-activator-a12-plus"]);
  });
  it("lê --config <arq> e --config=<arq>; specs herdam oldSlug", () => {
    for (const argv of [["--config", helloPath], [`--config=${helloPath}`, "--apply"]]) {
      const plan = loadPlan(argv);
      expect(plan.oldSlugs).toEqual(["frpfile-ramdisk-hello-wifi"]);
      expect(plan.externalIds).toEqual(["222", "224", "4493"]);
      expect(new Set(plan.slugs).size).toBe(3);
    }
    expect(() => configPathFrom(["--config"])).toThrow(/--config exige/);
    expect(() => configPathFrom(["--config", "--apply"])).toThrow(/--config exige/);
  });
  it("nomes públicos do config sem o texto técnico do fornecedor", () => {
    for (const s of loadPlan(["--config", helloPath]).specs)
      for (const text of [s.name, s.description]) expect(text).not.toMatch(/Untethered|with Notification|no Signal|Broken|tool Bypass/i);
  });
  it("recusa spec incompleta ou slug/externalId repetido", () => {
    const base = { oldSlug: "o", variantCode: "v", externalId: "1", slug: "s", name: "n", description: "d", fieldLabel: "ECID", expectedDeliveryType: "TEXT", fieldKeys: ["ecid"], sortOrder: 1 };
    expect(() => buildPlan([])).toThrow(/sem specs/);
    expect(() => buildPlan([{ ...base, name: "" }])).toThrow(/faltando name/);
    expect(() => buildPlan([base, { ...base, externalId: "2" }])).toThrow(/slug repetido/);
    expect(() => buildPlan([base, { ...base, slug: "s2" }])).toThrow(/externalId repetido/);
  });
  it("variante inativa só passa com allowInactiveVariant", () => {
    const inactive = { ...old, variants: [{ ...old.variants[0], active: false }] };
    expect(sourceVariantProblems(inactive, spec, pp())).toEqual(["variante inativa"]);
    expect(sourceVariantProblems(inactive, { ...spec, allowInactiveVariant: true }, pp())).toEqual([]);
  });
  it("reversão usa slugs/ids do plano informado", () => {
    const sql = revertSql(loadPlan(["--config", helloPath]));
    expect(sql).toMatch(/'222', '224', '4493'/);
    expect(sql).toMatch(/apagar os 3 Products/);
    expect(revertSql()).toMatch(/apagar os 5 Products/);
  });
});
