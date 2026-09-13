import type { Prisma, PricingConfiguration, PricingGroupRule, ProductType } from "@prisma/client";
import { prisma } from "./prisma";
import { isProductionProviderCode } from "./providers/selection";
import {
  calculatePricing,
  summarizePricingResults,
  type GlobalPricingRule,
  type GroupPricingRule,
  type PricingModeValue,
  type PricingResult,
} from "./pricing";

export type PricingContext = {
  global: GlobalPricingRule;
  groups: Map<string, GroupPricingRule>;
};

export type PricingProductSource = {
  id: string;
  type: ProductType | string;
  pricingMode: PricingModeValue;
  manualPriceCents: number | null;
  priceCents: number;
  providerProducts: Array<{
    providerCostCents: number | null;
    currency: string;
    active: boolean;
    mode: string;
    provider: { active: boolean; code: string };
  }>;
};

export type PricingVariantSource = {
  id: string;
  priceCents: number | null;
  pricingMode: PricingModeValue;
  manualPriceCents: number | null;
  providerProduct: {
    providerCostCents: number | null;
    currency: string;
  };
  product: { type: ProductType | string };
};

export const isPricingSimulationEligible = (row: {
  active: boolean;
  mode: string;
  provider: { active: boolean; code: string };
}) => row.active && row.mode === "REAL" && row.provider.active && isProductionProviderCode(row.provider.code);

export const disabledPricingConfiguration: GlobalPricingRule = {
  automaticEnabled: false,
  exchangeRateMicros: null,
  exchangeBufferBps: 0,
  targetMarginBps: 0,
  minimumProfitCents: 0,
  asaasFeeType: "FIXED",
  asaasFixedFeeCents: 0,
  asaasPercentBps: 0,
  roundingMode: "NONE",
  minimumPriceCents: 0,
};

export const pricingRuleForSimulation = (global: GlobalPricingRule): GlobalPricingRule => ({
  ...global,
  automaticEnabled: true,
});

function globalRule(config: PricingConfiguration): GlobalPricingRule {
  return {
    automaticEnabled: config.automaticEnabled,
    exchangeRateMicros: config.exchangeRateMicros,
    exchangeBufferBps: config.exchangeBufferBps,
    targetMarginBps: config.targetMarginBps,
    minimumProfitCents: config.minimumProfitCents,
    asaasFeeType: config.asaasFeeType,
    asaasFixedFeeCents: config.asaasFixedFeeCents,
    asaasPercentBps: config.asaasPercentBps,
    roundingMode: config.roundingMode,
    minimumPriceCents: config.minimumPriceCents,
  };
}

function groupRule(rule: PricingGroupRule): GroupPricingRule {
  return {
    productType: rule.productType,
    exchangeBufferBps: rule.exchangeBufferBps,
    targetMarginBps: rule.targetMarginBps,
    minimumProfitCents: rule.minimumProfitCents,
    minimumPriceCents: rule.minimumPriceCents,
    roundingMode: rule.roundingMode,
    additionalFeeCents: rule.additionalFeeCents,
    additionalFeeBps: rule.additionalFeeBps,
  };
}

export async function loadPricingContext(): Promise<PricingContext> {
  const config = await prisma.pricingConfiguration.findUnique({
    where: { id: "default" },
    include: { groupRules: true },
  });
  if (!config) return { global: disabledPricingConfiguration, groups: new Map() };
  return {
    global: globalRule(config),
    groups: new Map(config.groupRules.map((rule) => [rule.productType, groupRule(rule)])),
  };
}

export function calculateProductPricing(product: PricingProductSource, context: PricingContext): PricingResult {
  const eligible = product.providerProducts.filter(
    (link) => link.active && link.mode === "REAL" && link.provider.active && isProductionProviderCode(link.provider.code),
  );
  const providerProduct = eligible.length === 1 ? eligible[0] : null;
  const result = calculatePricing({
    pricingMode: product.pricingMode,
    manualPriceCents: product.manualPriceCents,
    providerCostCents: providerProduct?.providerCostCents,
    providerCurrency: providerProduct?.currency,
    productType: product.type,
    global: context.global,
    group: context.groups.get(product.type),
  });
  if (eligible.length > 1) return { ...result, pricingStatus: "NEEDS_REVIEW", reason: "MULTIPLE_OPERATIONAL_PROVIDERS" };
  return result;
}

export function calculateVariantPricing(
  variant: PricingVariantSource,
  context: PricingContext,
): PricingResult {
  return calculatePricing({
    pricingMode: variant.pricingMode,
    manualPriceCents: variant.manualPriceCents,
    providerCostCents: variant.providerProduct.providerCostCents,
    providerCurrency: variant.providerProduct.currency,
    productType: variant.product.type,
    global: context.global,
    group: context.groups.get(variant.product.type),
  });
}

export function pricingUpdateData(product: PricingProductSource, result: PricingResult) {
  const data: Prisma.ProductUpdateInput = {
    suggestedPriceCents: result.suggestedPriceCents,
    pricingStatus: result.pricingStatus,
    pricingComputedAt: new Date(),
  };
  if (product.pricingMode !== "MANUAL" && result.pricingStatus === "AUTO_OK" && result.effectivePriceCents != null) {
    data.priceCents = result.effectivePriceCents;
  }
  return data;
}

export function variantPricingUpdateData(
  variant: PricingVariantSource,
  result: PricingResult,
) {
  return {
    suggestedPriceCents: result.suggestedPriceCents,
    pricingStatus: result.pricingStatus,
    pricingComputedAt: new Date(),
    ...(variant.pricingMode === "MANUAL" && result.effectivePriceCents != null
      ? { priceCents: result.effectivePriceCents }
      : variant.pricingMode !== "MANUAL" &&
          contextAllowsAutomaticPrice(result)
        ? { priceCents: result.effectivePriceCents }
        : {}),
  };
}

const contextAllowsAutomaticPrice = (result: PricingResult) =>
  result.pricingStatus === "AUTO_OK" && result.effectivePriceCents != null;

export async function recalculateProducts(ids: string[]) {
  const context = await loadPricingContext();
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: { providerProducts: { include: { provider: true } } },
  });
  const updates = products.map((product) => {
    const result = calculateProductPricing(product, context);
    return prisma.product.update({ where: { id: product.id }, data: pricingUpdateData(product, result) });
  });
  if (updates.length) await prisma.$transaction(updates);
  return products.length;
}

export async function recalculateVariants(providerProductIds: string[]) {
  if (!providerProductIds.length) return 0;
  const context = await loadPricingContext();
  const variants = await prisma.productVariant.findMany({
    where: { providerProductId: { in: providerProductIds } },
    include: { providerProduct: true, product: { select: { type: true } } },
  });
  const updates = variants.map((variant) => {
    const result = calculateVariantPricing(variant, context);
    return prisma.productVariant.update({
      where: { id: variant.id },
      data: variantPricingUpdateData(variant, result),
    });
  });
  if (updates.length) await prisma.$transaction(updates);
  return variants.length;
}

export async function simulateProviderProductPricing() {
  const context = await loadPricingContext();
  const simulationGlobal = pricingRuleForSimulation(context.global);
  const rows = await prisma.providerProduct.findMany({
    include: {
      provider: { select: { active: true, code: true } },
      product: { select: { id: true, type: true, pricingMode: true, manualPriceCents: true, priceCents: true } },
    },
  });
  const results = rows.filter(isPricingSimulationEligible).map((row) => {
    const product = row.product;
    const pricingMode: PricingModeValue = product && context.groups.has(product.type) ? "AUTO_GROUP" : "AUTO_GLOBAL";
    const result = calculatePricing({
      pricingMode,
      manualPriceCents: null,
      providerCostCents: row.providerCostCents,
      providerCurrency: row.currency,
      productType: product?.type ?? "UNLINKED",
      global: simulationGlobal,
      group: product ? context.groups.get(product.type) : null,
    });
    return { row, result, group: product?.type ?? "UNLINKED" };
  });
  return summarizePricingResults(results.map(({ row, result, group }) => ({ result, group, automationClass: row.automationClass })));
}
