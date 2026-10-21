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

// Limites de toda recarga (pacote fixo ou "Outro valor"): mínimo R$ 15,00; o
// máximo vale para o valor livre (os pacotes fixos já ficam abaixo dele).
export const TOPUP_MIN_CENTS = 1500;
export const TOPUP_FREE_MAX_CENTS = 500000;
export const INVALID_TOPUP_AMOUNT_MESSAGE = "Informe um valor de recarga entre R$ 15,00 e R$ 5.000,00.";

const topupMetadata = (metadata: unknown) =>
  metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};

// Pacote "Outro valor": ProviderProduct interno com metadata.freeAmount = true
// (sem creditAmountCents). O valor é escolhido pelo cliente no checkout.
export function isFreeAmountTopup(metadata: unknown) {
  return topupMetadata(metadata).freeAmount === true;
}

// Valor livre válido: inteiro em centavos entre o mínimo e o máximo.
export function validTopupAmountCents(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= TOPUP_MIN_CENTS && value <= TOPUP_FREE_MAX_CENTS
    ? value
    : null;
}

// Texto digitado ("15", "15,50", "1.234,56") → centavos; null se não for um
// valor em reais com até 2 casas.
export function parseTopupAmountInput(text: string) {
  const normalized = text.trim().replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

// Recarga de Saldo (BALANCE_TOPUP): o preço é SEMPRE o valor creditado pelo
// pacote (ProviderProduct.metadata.creditAmountCents), em qualquer tier.
// priceCents e os preços por tier são ignorados, então o valor cobrado nunca
// diverge do valor creditado. null = pacote sem crédito válido ou abaixo do
// mínimo da recarga (não vendável).
export function topupCreditCents(metadata: unknown) {
  const value = topupMetadata(metadata).creditAmountCents;
  const credit = positive(typeof value === "number" ? value : null);
  return credit !== null && credit >= TOPUP_MIN_CENTS ? credit : null;
}

export function assertCheckoutPrice(
  product: TieredPriceSource & { priceVisibility: PriceVisibilityValue; type?: string },
  variant: TieredPriceSource | null,
  viewer: PriceViewer,
  purchased?: { metadata?: unknown } | null,
  // Só para o pacote "Outro valor": o valor escolhido (centavos).
  topupAmountCents?: number,
) {
  if (product.priceVisibility === "LOGIN_REQUIRED" && !viewer)
    throw new Error("LOGIN_REQUIRED_FOR_PRICE");
  if (product.type === "BALANCE_TOPUP" && isFreeAmountTopup(purchased?.metadata)) {
    const amountCents = validTopupAmountCents(topupAmountCents);
    if (!amountCents) throw new Error("INVALID_TOPUP_AMOUNT");
    return amountCents;
  }
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