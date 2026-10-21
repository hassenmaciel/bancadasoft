// Pagamento por saldo no checkout da loja. Regra única usada pela página do
// produto (decide se a opção aparece) e por createOrder (valida antes de criar
// o pedido) — o débito em si continua em debitOrderPurchase, que revalida
// enabled/saldo com a linha travada. Módulo puro: também é importado pelo
// painel de checkout no client, então não pode depender de Prisma.

export type BalancePaymentAccount = {
  customerTier: string;
  canUseBalanceAsPayment: boolean;
  accountBalance: { enabled: boolean; balanceCents: number } | null;
};

// O que o client recebe: só o saldo disponível, nunca tier/flags.
export type BalancePaymentOption = { balanceCents: number };

// PREMIUM_PLUS sempre pode; os demais tiers dependem da flag do Admin.
export function hasBalancePaymentPermission(account: Pick<BalancePaymentAccount, "customerTier" | "canUseBalanceAsPayment">) {
  return account.canUseBalanceAsPayment === true || account.customerTier === "PREMIUM_PLUS";
}

// Recarga de saldo não pode ser paga com o próprio saldo.
export function productAcceptsBalancePayment(productType: string) {
  return productType !== "BALANCE_TOPUP";
}

// Compra de PREMIUM_PLUS (exceto recarga, sempre PIX). Saldo e PIX são
// caminhos exclusivos, decididos pelo saldo:
// - saldo habilitado que cobre o total ao preço Premium Plus → só saldo, ao
//   preço Premium Plus;
// - senão → só PIX, ao menor preço ativo Premium/Técnico (premiumPlusPixPrice
//   em commercial-pricing.ts); sem esse preço, a compra por PIX é recusada.
// O servidor (createOrder) aplica a mesma regra; a tela só a reflete.
export function premiumPlusPaymentMethod(
  balance: { enabled: boolean; balanceCents: number } | null | undefined,
  plusTotalCents: number | null,
): "balance" | "pix" {
  return plusTotalCents !== null && balance?.enabled === true && balance.balanceCents >= plusTotalCents ? "balance" : "pix";
}

// Preço unitário e forma de pagamento de PREMIUM_PLUS para uma quantidade.
// unitCents null = PIX sem preço (nem Premium nem Técnico ativos).
export function premiumPlusPayment(
  balance: { enabled: boolean; balanceCents: number } | null | undefined,
  prices: { plusPriceCents: number | null; pixPriceCents: number | null },
  quantity: number,
) {
  const method = premiumPlusPaymentMethod(balance, prices.plusPriceCents === null ? null : prices.plusPriceCents * quantity);
  return { method, unitCents: method === "balance" ? prices.plusPriceCents : prices.pixPriceCents };
}

// null = a opção "Pagar com saldo" não aparece para este cliente/produto.
export function balancePaymentOption(
  account: BalancePaymentAccount | null,
  productType: string,
): BalancePaymentOption | null {
  if (!account || !productAcceptsBalancePayment(productType)) return null;
  if (!hasBalancePaymentPermission(account) || !account.accountBalance?.enabled) return null;
  return { balanceCents: account.accountBalance.balanceCents };
}

export function balanceShortfallCents(balanceCents: number, totalCents: number) {
  return Math.max(0, totalCents - balanceCents);
}
