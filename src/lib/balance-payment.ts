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
