import { describe, expect, it } from "vitest";
import { calculatePricing, roundCommercial, summarizePricingResults, type GlobalPricingRule } from "./pricing";
import { isPricingSimulationEligible, pricingRuleForSimulation, pricingUpdateData, type PricingProductSource } from "./pricing-service";

const global: GlobalPricingRule = {
  automaticEnabled: true,
  exchangeRateMicros: 5_000_000,
  exchangeBufferBps: 1_000,
  targetMarginBps: 2_000,
  minimumProfitCents: 500,
  asaasFeeType: "COMBINED",
  asaasFixedFeeCents: 100,
  asaasPercentBps: 300,
  roundingMode: "NONE",
  minimumPriceCents: 0,
};

const price = (overrides: Partial<Parameters<typeof calculatePricing>[0]> = {}) => calculatePricing({
  pricingMode: "AUTO_GLOBAL",
  providerCostCents: 100,
  providerCurrency: "USD",
  productType: "RENTAL",
  global,
  ...overrides,
});

describe("pricing engine", () => {
  it("calculates global pricing with exchange buffer and margin over sale price", () => {
    const result = price();
    expect(result.providerCostBrlCents).toBe(550);
    expect(result.suggestedPriceCents).toBe(1186);
    expect(result.estimatedProfitCents).toBe(500);
    expect(result.estimatedMarginBps).toBe(Math.round(500 / 1186 * 10_000));
    expect(result.pricingStatus).toBe("AUTO_OK");
  });

  it("applies group overrides ahead of global values", () => {
    const result = price({ pricingMode: "AUTO_GROUP", group: { productType: "RENTAL", exchangeBufferBps: null, targetMarginBps: null, minimumProfitCents: 1_000, minimumPriceCents: null, roundingMode: null, additionalFeeCents: null, additionalFeeBps: null } });
    expect(result.appliedRule).toBe("GROUP");
    expect(result.minimumProfitCents).toBe(1_000);
    expect(result.suggestedPriceCents).toBe(1702);
  });

  it("keeps a manual override as the effective price", () => {
    const result = price({ pricingMode: "MANUAL", manualPriceCents: 2_900 });
    expect(result.pricingStatus).toBe("MANUAL");
    expect(result.effectivePriceCents).toBe(2_900);
    expect(result.suggestedPriceCents).toBe(1_186);
  });

  it("keeps manual price after provider cost changes", () => {
    expect(price({ pricingMode: "MANUAL", manualPriceCents: 2_900, providerCostCents: 100 }).effectivePriceCents).toBe(2_900);
    expect(price({ pricingMode: "MANUAL", manualPriceCents: 2_900, providerCostCents: 200 }).effectivePriceCents).toBe(2_900);
  });

  it("never writes the effective public price for a manual product during recalculation", () => {
    const product = {
      id: "manual-product",
      type: "RENTAL",
      pricingMode: "MANUAL",
      manualPriceCents: 2_900,
      priceCents: 2_900,
      providerProducts: [],
    } satisfies PricingProductSource;
    const update = pricingUpdateData(product, price({ pricingMode: "MANUAL", manualPriceCents: 2_900 }));
    expect(update).not.toHaveProperty("priceCents");
    expect(update.suggestedPriceCents).toBe(1_186);
    expect(update.pricingStatus).toBe("MANUAL");
  });

  it("recalculates an automatic price after provider cost changes", () => {
    expect(price({ providerCostCents: 200 }).suggestedPriceCents).toBeGreaterThan(price({ providerCostCents: 100 }).suggestedPriceCents!);
  });

  it("writes an AUTO_OK effective price during automatic recalculation", () => {
    const product = {
      id: "automatic-product",
      type: "RENTAL",
      pricingMode: "AUTO_GLOBAL",
      manualPriceCents: null,
      priceCents: 2_900,
      providerProducts: [],
    } satisfies PricingProductSource;
    const result = price();
    expect(pricingUpdateData(product, result).priceCents).toBe(result.effectivePriceCents);
  });

  it("enforces minimum profit", () => expect(price().estimatedProfitCents).toBeGreaterThanOrEqual(500));
  it("enforces minimum price", () => expect(price({ global: { ...global, minimumPriceCents: 5_000 } }).suggestedPriceCents).toBe(5_000));

  it("supports a fixed Asaas fee", () => {
    const result = price({ global: { ...global, asaasFeeType: "FIXED", asaasFixedFeeCents: 199, asaasPercentBps: 900 } });
    expect(result.paymentFeeCents).toBe(199);
  });

  it("supports a percentage Asaas fee", () => {
    const result = price({ global: { ...global, asaasFeeType: "PERCENTAGE", asaasFixedFeeCents: 999, asaasPercentBps: 300 } });
    expect(result.paymentFeeCents).toBe(Math.round(result.effectivePriceCents! * 0.03));
  });

  it("supports combined Asaas fees", () => {
    const result = price();
    expect(result.paymentFeeCents).toBe(100 + Math.round(result.effectivePriceCents! * 0.03));
  });

  it("supports every commercial rounding mode without rounding down", () => {
    expect(roundCommercial(1437, "NONE")).toBe(1437);
    expect(roundCommercial(1437, "X_90")).toBe(1490);
    expect(roundCommercial(1912, "X_99")).toBe(1999);
    expect(roundCommercial(1437, "NEAREST_1")).toBe(1500);
    expect(roundCommercial(1437, "NEAREST_5")).toBe(1500);
  });

  it("rejects invalid configuration", () => expect(price({ global: { ...global, targetMarginBps: 9_900, asaasPercentBps: 300 } }).pricingStatus).toBe("INVALID_CONFIG"));
  it("reports missing provider cost", () => expect(price({ providerCostCents: null }).pricingStatus).toBe("NO_COST"));
  it("reports zero provider cost", () => expect(price({ providerCostCents: 0 }).reason).toBe("PROVIDER_COST_ZERO"));

  it("preserves UnlockTool manual pricing independently from its low provider cost", () => {
    const result = price({ pricingMode: "MANUAL", manualPriceCents: 2_900, providerCostCents: 28 });
    expect(result.effectivePriceCents).toBe(2_900);
    expect(result.pricingStatus).toBe("MANUAL");
  });

  it("calculates AMT with the same generic rental rule", () => {
    const result = price({ pricingMode: "AUTO_GROUP", providerCostCents: 30, group: { productType: "RENTAL", exchangeBufferBps: null, targetMarginBps: 2_500, minimumProfitCents: 700, minimumPriceCents: 990, roundingMode: "X_90", additionalFeeCents: 0, additionalFeeBps: 0 } });
    expect(result.appliedRule).toBe("GROUP");
    expect(result.suggestedPriceCents).toBeGreaterThanOrEqual(990);
  });

  it("summarizes a catalog simulation without changing inputs", () => {
    const valid = price();
    const missing = price({ providerCostCents: null });
    const report = summarizePricingResults([
      { result: valid, group: "RENTAL", automationClass: "AUTO_CREDENTIAL" },
      { result: missing, group: "UNLINKED", automationClass: "MANUAL_REVIEW" },
    ]);
    expect(report).toMatchObject({ providerProducts: 2, validCosts: 1, suggested: 1, statuses: { AUTO_OK: 1, NO_COST: 1 } });
    expect(report.byGroup).toEqual({ RENTAL: 1, UNLINKED: 1 });
  });

  it("excludes inactive sandbox history from the commercial simulation", () => {
    expect(isPricingSimulationEligible({ active: false, mode: "TEST", provider: { active: false, code: "mock-sandbox" } })).toBe(false);
    expect(isPricingSimulationEligible({ active: true, mode: "REAL", provider: { active: true, code: "heartunlocks" } })).toBe(true);
  });

  it("simulates valid automatic pricing without enabling it operationally", () => {
    const disabled = { ...global, automaticEnabled: false };
    const simulation = pricingRuleForSimulation(disabled);
    expect(simulation.automaticEnabled).toBe(true);
    expect(disabled.automaticEnabled).toBe(false);
    expect(price({ global: simulation }).pricingStatus).toBe("AUTO_OK");
  });
});
