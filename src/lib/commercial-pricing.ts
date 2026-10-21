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

// PREMIUM_PLUS pagando por PIX (o saldo não cobre o total ao preço Premium
// Plus): menor preço ATIVO entre Premium e Técnico (normalPriceCents) da fonte —
// a variante, ou o produto sem variante. Nunca o Premium Plus nem o Público.
// null = sem preço para PIX (a compra por PIX é recusada).
export const PIX_PRICE_UNAVAILABLE_MESSAGE =
  "Este produto não tem preço para PIX na sua conta. Recarregue o saldo para comprar com saldo.";

export function premiumPlusPixPrice(source: TieredPriceSource) {
  const prices = [positive(source.premiumPriceCents), positive(source.normalPriceCents)].filter(
    (price): price is number => price !== null,
  );
  return prices.length ? Math.min(...prices) : null;
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

export const BALANCE_TOPUP_BLOCKED_MESSAGE = "A recarga de saldo está bloqueada para a sua conta. Fale com o suporte.";

// Recarga de Saldo (ProductType.BALANCE_TOPUP): aberta a qualquer conta
// logada (AccountBalance.enabled não é exigido — o saldo é ativado pelo
// crédito da recarga), exceto quando o Admin bloqueou a recarga
// (User.balanceTopupBlocked). Chamado em commerce.createOrder antes de criar
// Order/Payment. Qualquer outro tipo de produto passa direto.
export function assertBalanceTopupAllowed(
  productType: string,
  account: { authenticated: boolean; topupBlocked: boolean },
) {
  if (productType !== "BALANCE_TOPUP") return;
  if (!account.authenticated) throw new Error("LOGIN_REQUIRED_FOR_PRICE");
  if (account.topupBlocked) throw new Error("BALANCE_TOPUP_BLOCKED");
}