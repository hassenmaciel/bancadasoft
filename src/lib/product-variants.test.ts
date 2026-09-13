import { describe, expect, it } from "vitest";
import {
  canPublishVariantProduct,
  publicVariantFields,
  resolveCheckoutVariant,
  resolvePurchasedProviderProduct,
  type CheckoutVariantCandidate,
} from "./product-variants";
import { calculateVariantPricing } from "./pricing-service";

const providerProduct = (overrides = {}) => ({
  id: "provider-product-221",
  productId: null,
  externalProductId: "221",
  active: true,
  mode: "REAL" as const,
  providerCostCents: 90,
  currency: "USD",
  technicalEligibility: "READY" as const,
  fieldSchema: [{ key: "serial", label: "Serial Number", type: "serial", required: true, customerVisible: true, sensitive: false }],
  provider: { id: "heartunlocks", code: "heartunlocks", active: true },
  ...overrides,
});

const variant = (overrides = {}): CheckoutVariantCandidate => ({
  id: "variant-221",
  name: "Premium",
  code: "premium",
  active: true,
  sortOrder: 10,
  priceCents: 1990,
  publicationBlocked: false,
  providerProduct: providerProduct(),
  ...overrides,
});

describe("commercial product variants", () => {
  it("keeps the legacy path for a product without variants", () => {
    expect(resolveCheckoutVariant([], undefined, "REAL")).toBeNull();
  });

  it("selects one or multiple configured variants explicitly", () => {
    const first = variant();
    const second = variant({ id: "variant-223", providerProduct: providerProduct({ id: "pp-223", externalProductId: "223" }) });
    expect(resolveCheckoutVariant([first], first.id, "REAL")).toMatchObject({ status: "SELECTED", priceCents: 1990 });
    expect(resolveCheckoutVariant([first, second], second.id, "REAL")).toMatchObject({ status: "SELECTED", providerProduct: { externalProductId: "223" } });
    expect(resolveCheckoutVariant([first, second], undefined, "REAL")?.status).toBe("VARIANT_REQUIRED");
  });

  it("rejects arbitrary, cross-product, inactive, held, unpriced and provider-inactive variants", () => {
    expect(resolveCheckoutVariant([variant()], "other-product-variant", "REAL")?.status).toBe("VARIANT_NOT_FOUND");
    expect(resolveCheckoutVariant([variant({ active: false })], "variant-221", "REAL")?.status).toBe("VARIANT_INACTIVE");
    expect(resolveCheckoutVariant([variant({ publicationBlocked: true })], "variant-221", "REAL")?.status).toBe("VARIANT_BLOCKED");
    expect(resolveCheckoutVariant([variant({ priceCents: null })], "variant-221", "REAL")?.status).toBe("VARIANT_PRICE_UNAVAILABLE");
    expect(resolveCheckoutVariant([variant({ providerProduct: providerProduct({ active: false }) })], "variant-221", "REAL")?.status).toBe("PROVIDER_UNAVAILABLE");
  });

  it("uses the technical schema from the selected provider product", () => {
    const selected = resolveCheckoutVariant([variant()], "variant-221", "REAL");
    expect(selected?.status).toBe("SELECTED");
    if (selected?.status === "SELECTED")
      expect(publicVariantFields(selected.providerProduct.fieldSchema)).toEqual([expect.objectContaining({ key: "serial", label: "Serial Number", sensitive: false })]);
  });

  it("supports distinct and manual prices per variant", () => {
    const context = {
      global: { automaticEnabled: false, exchangeRateMicros: 5_500_000, exchangeBufferBps: 500, targetMarginBps: 6000, minimumProfitCents: 500, asaasFeeType: "FIXED" as const, asaasFixedFeeCents: 99, asaasPercentBps: 0, roundingMode: "X_90" as const, minimumPriceCents: 1000 },
      groups: new Map(),
    };
    const manual = calculateVariantPricing({ id: "v", priceCents: 2990, pricingMode: "MANUAL", manualPriceCents: 2990, providerProduct: { providerCostCents: 90, currency: "USD" }, product: { type: "IMEI_SN" } }, context);
    const automatic = calculateVariantPricing({ id: "v2", priceCents: null, pricingMode: "AUTO_GLOBAL", manualPriceCents: null, providerProduct: { providerCostCents: 380, currency: "USD" }, product: { type: "IMEI_SN" } }, { ...context, global: { ...context.global, automaticEnabled: true } });
    expect(manual.effectivePriceCents).toBe(2990);
    expect(manual.pricingStatus).toBe("MANUAL");
    expect(automatic.suggestedPriceCents).toBe(5790);
  });

  it("persists provider selection independently from later variant changes", () => {
    const purchased = providerProduct({ id: "persisted-221" });
    const laterVariantTarget = providerProduct({ id: "later-3126", externalProductId: "3126" });
    expect(resolvePurchasedProviderProduct(purchased, [laterVariantTarget], "REAL")).toMatchObject({ status: "SELECTED", providerProduct: { id: "persisted-221", externalProductId: "221" } });
  });

  it("prevents publishing cards with only held or unpriced variants", () => {
    expect(canPublishVariantProduct([])).toBe(true);
    expect(canPublishVariantProduct([{ active: false, publicationBlocked: true, priceCents: null }])).toBe(false);
    expect(canPublishVariantProduct([{ active: true, publicationBlocked: false, priceCents: 1990 }])).toBe(true);
  });
});
