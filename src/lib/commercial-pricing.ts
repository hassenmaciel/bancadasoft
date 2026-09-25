export type CustomerTierValue = "NORMAL" | "PREMIUM";
export type PriceVisibilityValue = "PUBLIC" | "LOGIN_REQUIRED";

export type TieredPriceSource = {
  priceCents: number | null;
  normalPriceCents?: number | null;
  premiumPriceCents?: number | null;
};

export type PriceViewer = { customerTier: CustomerTierValue } | null;

const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

export function resolveTierPrice(source: TieredPriceSource, viewer: PriceViewer) {
  const publicPrice = positive(source.priceCents);
  if (!viewer) return publicPrice;
  if (viewer.customerTier === "PREMIUM")
    return (
      positive(source.premiumPriceCents) ??
      positive(source.normalPriceCents) ??
      publicPrice
    );
  return positive(source.normalPriceCents) ?? publicPrice;
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

export function assertCheckoutPrice(
  product: TieredPriceSource & { priceVisibility: PriceVisibilityValue },
  variant: TieredPriceSource | null,
  viewer: PriceViewer,
) {
  if (product.priceVisibility === "LOGIN_REQUIRED" && !viewer)
    throw new Error("LOGIN_REQUIRED_FOR_PRICE");
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
