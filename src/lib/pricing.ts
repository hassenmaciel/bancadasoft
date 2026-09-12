export const pricingModes = ["AUTO_GLOBAL", "AUTO_GROUP", "MANUAL"] as const;
export const pricingStatuses = ["AUTO_OK", "MANUAL", "NEEDS_REVIEW", "NO_COST", "INVALID_CONFIG"] as const;
export const pricingFeeTypes = ["FIXED", "PERCENTAGE", "COMBINED"] as const;
export const pricingRoundingModes = ["NONE", "X_90", "X_99", "NEAREST_1", "NEAREST_5"] as const;

export type PricingModeValue = (typeof pricingModes)[number];
export type PricingStatusValue = (typeof pricingStatuses)[number];
export type PricingFeeTypeValue = (typeof pricingFeeTypes)[number];
export type PricingRoundingModeValue = (typeof pricingRoundingModes)[number];

export type GlobalPricingRule = {
  automaticEnabled: boolean;
  exchangeRateMicros: number | null;
  exchangeBufferBps: number;
  targetMarginBps: number;
  minimumProfitCents: number;
  asaasFeeType: PricingFeeTypeValue;
  asaasFixedFeeCents: number;
  asaasPercentBps: number;
  roundingMode: PricingRoundingModeValue;
  minimumPriceCents: number;
};

export type GroupPricingRule = {
  productType: string;
  exchangeBufferBps: number | null;
  targetMarginBps: number | null;
  minimumProfitCents: number | null;
  minimumPriceCents: number | null;
  roundingMode: PricingRoundingModeValue | null;
  additionalFeeCents: number | null;
  additionalFeeBps: number | null;
};

export type PricingResult = {
  pricingMode: PricingModeValue;
  pricingStatus: PricingStatusValue;
  appliedRule: "GLOBAL" | "GROUP";
  providerCostCents: number | null;
  providerCurrency: string | null;
  exchangeRateMicros: number | null;
  exchangeBufferBps: number;
  providerCostBrlCents: number | null;
  paymentFeeCents: number | null;
  suggestedPriceCents: number | null;
  effectivePriceCents: number | null;
  estimatedProfitCents: number | null;
  estimatedMarginBps: number | null;
  targetMarginBps: number;
  minimumProfitCents: number;
  minimumPriceCents: number;
  roundingMode: PricingRoundingModeValue;
  reason: string | null;
};

const finiteInteger = (value: number) => Number.isFinite(value) && Number.isInteger(value);
const validNonNegative = (value: number) => finiteInteger(value) && value >= 0;

export function roundCommercial(cents: number, mode: PricingRoundingModeValue) {
  if (!Number.isFinite(cents) || cents < 0) return null;
  const value = Math.ceil(cents);
  if (mode === "NONE") return value;
  if (mode === "NEAREST_1") return Math.ceil(value / 100) * 100;
  if (mode === "NEAREST_5") return Math.ceil(value / 500) * 500;
  const ending = mode === "X_90" ? 90 : 99;
  const base = Math.floor(value / 100) * 100;
  const candidate = base + ending;
  return candidate >= value ? candidate : candidate + 100;
}

function resolvedRule(
  mode: PricingModeValue,
  global: GlobalPricingRule,
  group?: GroupPricingRule | null,
) {
  const useGroup = mode !== "AUTO_GLOBAL" && !!group;
  return {
    appliedRule: useGroup ? "GROUP" as const : "GLOBAL" as const,
    exchangeBufferBps: useGroup && group?.exchangeBufferBps != null ? group.exchangeBufferBps : global.exchangeBufferBps,
    targetMarginBps: useGroup && group?.targetMarginBps != null ? group.targetMarginBps : global.targetMarginBps,
    minimumProfitCents: useGroup && group?.minimumProfitCents != null ? group.minimumProfitCents : global.minimumProfitCents,
    minimumPriceCents: useGroup && group?.minimumPriceCents != null ? group.minimumPriceCents : global.minimumPriceCents,
    roundingMode: useGroup && group?.roundingMode != null ? group.roundingMode : global.roundingMode,
    additionalFeeCents: useGroup ? group?.additionalFeeCents ?? 0 : 0,
    additionalFeeBps: useGroup ? group?.additionalFeeBps ?? 0 : 0,
  };
}

export function calculatePricing(input: {
  pricingMode: PricingModeValue;
  manualPriceCents?: number | null;
  providerCostCents?: number | null;
  providerCurrency?: string | null;
  productType: string;
  global: GlobalPricingRule;
  group?: GroupPricingRule | null;
}): PricingResult {
  const rule = resolvedRule(input.pricingMode, input.global, input.group);
  const base = {
    pricingMode: input.pricingMode,
    appliedRule: rule.appliedRule,
    providerCostCents: input.providerCostCents ?? null,
    providerCurrency: input.providerCurrency?.toUpperCase() ?? null,
    exchangeRateMicros: input.global.exchangeRateMicros,
    exchangeBufferBps: rule.exchangeBufferBps,
    providerCostBrlCents: null,
    paymentFeeCents: null,
    suggestedPriceCents: null,
    effectivePriceCents: null,
    estimatedProfitCents: null,
    estimatedMarginBps: null,
    targetMarginBps: rule.targetMarginBps,
    minimumProfitCents: rule.minimumProfitCents,
    minimumPriceCents: rule.minimumPriceCents,
    roundingMode: rule.roundingMode,
  };
  const fail = (pricingStatus: PricingStatusValue, reason: string): PricingResult => ({ ...base, pricingStatus, reason });

  if (!validNonNegative(input.providerCostCents ?? -1) || !input.providerCostCents) {
    return fail("NO_COST", input.providerCostCents === 0 ? "PROVIDER_COST_ZERO" : "PROVIDER_COST_MISSING");
  }

  const globalValues = [
    input.global.exchangeBufferBps,
    input.global.targetMarginBps,
    input.global.minimumProfitCents,
    input.global.asaasFixedFeeCents,
    input.global.asaasPercentBps,
    input.global.minimumPriceCents,
  ];
  const ruleValues = [rule.exchangeBufferBps, rule.targetMarginBps, rule.minimumProfitCents, rule.minimumPriceCents, rule.additionalFeeCents, rule.additionalFeeBps];
  const currency = input.providerCurrency?.toUpperCase();
  const exchangeValid = currency === "BRL" || (currency === "USD" && validNonNegative(input.global.exchangeRateMicros ?? -1) && (input.global.exchangeRateMicros ?? 0) > 0);
  const configValid = globalValues.every(validNonNegative) && ruleValues.every(validNonNegative) && rule.targetMarginBps < 10_000 && input.global.asaasPercentBps + rule.additionalFeeBps < 10_000 && pricingFeeTypes.includes(input.global.asaasFeeType) && pricingRoundingModes.includes(rule.roundingMode) && exchangeValid;
  if (!configValid) return fail("INVALID_CONFIG", "PRICING_CONFIGURATION_INVALID");

  const providerCostBrlCents = currency === "BRL"
    ? input.providerCostCents
    : Math.ceil(input.providerCostCents * (input.global.exchangeRateMicros! / 1_000_000) * (1 + rule.exchangeBufferBps / 10_000));
  const fixedFee = (input.global.asaasFeeType === "FIXED" || input.global.asaasFeeType === "COMBINED" ? input.global.asaasFixedFeeCents : 0) + rule.additionalFeeCents;
  const percentFeeBps = (input.global.asaasFeeType === "PERCENTAGE" || input.global.asaasFeeType === "COMBINED" ? input.global.asaasPercentBps : 0) + rule.additionalFeeBps;
  const marginDenominator = 1 - (percentFeeBps + rule.targetMarginBps) / 10_000;
  const profitDenominator = 1 - percentFeeBps / 10_000;
  if (marginDenominator <= 0 || profitDenominator <= 0) return fail("INVALID_CONFIG", "PRICING_PERCENTAGES_INVALID");

  const costAndFixed = providerCostBrlCents + fixedFee;
  const byCost = costAndFixed / profitDenominator;
  const byProfit = (costAndFixed + rule.minimumProfitCents) / profitDenominator;
  const byMargin = costAndFixed / marginDenominator;
  const rawSuggested = Math.max(byCost, byProfit, byMargin, rule.minimumPriceCents);
  const suggestedPriceCents = roundCommercial(rawSuggested, rule.roundingMode);
  if (!suggestedPriceCents || suggestedPriceCents < providerCostBrlCents) return fail("NEEDS_REVIEW", "SUGGESTED_PRICE_INVALID");

  const effectivePriceCents = input.pricingMode === "MANUAL" ? input.manualPriceCents ?? null : suggestedPriceCents;
  if (!effectivePriceCents || !validNonNegative(effectivePriceCents)) {
    return { ...base, providerCostBrlCents, suggestedPriceCents, pricingStatus: "NEEDS_REVIEW", reason: "EFFECTIVE_PRICE_INVALID" };
  }
  const paymentFeeCents = fixedFee + Math.round(effectivePriceCents * percentFeeBps / 10_000);
  const estimatedProfitCents = effectivePriceCents - providerCostBrlCents - paymentFeeCents;
  const estimatedMarginBps = Math.round(estimatedProfitCents / effectivePriceCents * 10_000);
  const pricingStatus: PricingStatusValue = input.pricingMode === "MANUAL" ? "MANUAL" : input.global.automaticEnabled ? "AUTO_OK" : "INVALID_CONFIG";
  return {
    ...base,
    pricingStatus,
    providerCostBrlCents,
    paymentFeeCents,
    suggestedPriceCents,
    effectivePriceCents,
    estimatedProfitCents,
    estimatedMarginBps,
    reason: pricingStatus === "INVALID_CONFIG" ? "AUTOMATIC_PRICING_DISABLED" : null,
  };
}

export function summarizePricingResults(rows: Array<{ result: PricingResult; group: string; automationClass: string }>) {
  const suggested = rows.filter(({ result }) => result.suggestedPriceCents != null);
  const margins = suggested.flatMap(({ result }) => result.estimatedMarginBps == null ? [] : [result.estimatedMarginBps]);
  const profits = suggested.flatMap(({ result }) => result.estimatedProfitCents == null ? [] : [result.estimatedProfitCents]);
  const prices = suggested.map(({ result }) => result.suggestedPriceCents!);
  const distribution = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const statusCount = (status: PricingStatusValue) => rows.filter(({ result }) => result.pricingStatus === status).length;
  return {
    providerProducts: rows.length,
    validCosts: rows.filter(({ result }) => (result.providerCostCents ?? 0) > 0).length,
    suggested: suggested.length,
    statuses: {
      NEEDS_REVIEW: statusCount("NEEDS_REVIEW"),
      NO_COST: statusCount("NO_COST"),
      INVALID_CONFIG: statusCount("INVALID_CONFIG"),
    },
    minimumSuggestedPriceCents: prices.length ? Math.min(...prices) : null,
    maximumSuggestedPriceCents: prices.length ? Math.max(...prices) : null,
    minimumMarginBps: margins.length ? Math.min(...margins) : null,
    averageMarginBps: average(margins),
    averageProfitCents: average(profits),
    byGroup: distribution(rows.map(({ group }) => group)),
    byAutomationClass: distribution(rows.map(({ automationClass }) => automationClass)),
    anomalies: rows.filter(({ result }) =>
      result.reason === "PROVIDER_COST_ZERO" ||
      result.reason === "PROVIDER_COST_MISSING" ||
      result.pricingStatus === "INVALID_CONFIG" ||
      (result.estimatedMarginBps ?? 0) < 0 ||
      ((result.suggestedPriceCents ?? Infinity) < (result.providerCostBrlCents ?? 0)),
    ).length,
  };
}
