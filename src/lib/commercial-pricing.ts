export type CustomerTierValue = "NORMAL" | "PREMIUM" | "PREMIUM_PLUS";
export type PriceVisibilityValue = "PUBLIC" | "LOGIN_REQUIRED";

export type TieredPriceSource = {
  priceCents: number | null;
  normalPriceCents?: number | null;
  premiumPriceCents?: number | null;
  premiumPlusPriceCents?: number | null;
};

export type PriceViewer = { customerTier: CustomerTierValue } | null;

const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

export function resolveTierPrice(source: TieredPriceSource, viewer: PriceViewer) {
  const publicPrice = positive(source.priceCents);
  if (!viewer) return publicPrice;
  // PREMIUM_PLUS usa o preço próprio quando preenchido; vazio cai exatamente
  // na mesma cadeia do PREMIUM (Premium → Técnico → Público).
  if (viewer.customerTier === "PREMIUM_PLUS" && positive(source.premiumPlusPriceCents))
    return positive(source.premiumPlusPriceCents);
  if (viewer.customerTier === "PREMIUM" || viewer.customerTier === "PREMIUM_PLUS")
    return (
      positive(source.premiumPriceCents) ??
      positive(source.normalPriceCents) ??
      publicPrice
    );
  return positive(source.normalPriceCents) ?? publicPrice;
}

// Aviso (nunca bloqueio) do Admin: Premium Plus acima do preço que o PREMIUM
// efetivamente paga. null = sem aviso.
export function premiumPlusPriceWarning(source: TieredPriceSource) {
  const premiumPlus = positive(source.premiumPlusPriceCents);
  const premium = resolveTierPrice({ ...source, premiumPlusPriceCents: null }, { customerTier: "PREMIUM" });
  if (!premiumPlus || !premium || premiumPlus <= premium) return null;
  return "Atenção: preço Premium Plus maior que o Premium.";
}

export function resolveVisiblePrice(
  source: TieredPriceSource & { priceVisibility: PriceVisibilityValue },
  viewer: PriceViewer,
) {
  if (source.priceVisibility === "LOGIN_REQUIRED" && !viewer)
    return { visible: false as const, priceCents: null, tier: null };
  const priceCents = resolveTierPrice(source, viewer);
  return {
    visible: priceCents !== null,
    priceCents,
    tier: viewer?.customerTier ?? null,
  };
}

// Recarga de Saldo (BALANCE_TOPUP): o preço é SEMPRE o valor creditado pelo
// pacote (ProviderProduct.metadata.creditAmountCents), em qualquer tier.
// priceCents e os preços por tier são ignorados, então o valor cobrado nunca
// diverge do valor creditado. null = pacote sem crédito válido (não vendável).
export function topupCreditCents(metadata: unknown) {
  const value =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).creditAmountCents
      : undefined;
  return positive(typeof value === "number" ? value : null);
}

export function assertCheckoutPrice(
  product: TieredPriceSource & { priceVisibility: PriceVisibilityValue; type?: string },
  variant: TieredPriceSource | null,
  viewer: PriceViewer,
  purchased?: { metadata?: unknown } | null,
) {
  if (product.priceVisibility === "LOGIN_REQUIRED" && !viewer)
    throw new Error("LOGIN_REQUIRED_FOR_PRICE");
  if (product.type === "BALANCE_TOPUP") {
    const creditCents = topupCreditCents(purchased?.metadata);
    if (!creditCents) throw new Error("PRICE_UNAVAILABLE");
    return creditCents;
  }
  const priceCents = resolveTierPrice(variant ?? product, viewer);
  if (!priceCents) throw new Error("PRICE_UNAVAILABLE");
  return priceCents;
}

// Recarga de Saldo (ProductType.BALANCE_TOPUP): além do LOGIN_REQUIRED do
// produto, exige conta logada com AccountBalance.enabled=true. Chamado em
// commerce.createOrder antes de criar Order/Payment. Qualquer outro tipo de
// produto passa direto, sem consulta adicional.
export function assertBalanceTopupAllowed(
  productType: string,
  account: { authenticated: boolean; balanceEnabled: boolean },
) {
  if (productType !== "BALANCE_TOPUP") return;
  if (!account.authenticated) throw new Error("LOGIN_REQUIRED_FOR_PRICE");
  if (!account.balanceEnabled) throw new Error("BALANCE_NOT_ENABLED");
}