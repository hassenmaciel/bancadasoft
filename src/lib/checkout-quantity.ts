// Quantidade por pedido (ex.: créditos Phoenix). Produto com min/max 1/1 —
// todo o catálogo anterior — só aceita exatamente 1, como antes. A validação
// roda no servidor em createOrder, antes de criar Order/Payment/PIX.
export type QuantityRule = { minQuantity?: number | null; maxQuantity?: number | null };

export class CheckoutQuantityError extends Error {
  constructor(readonly min: number, readonly max: number) {
    super("CHECKOUT_QUANTITY_INVALID");
    this.name = "CheckoutQuantityError";
  }
}

const positive = (value: number | null | undefined) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 1;

export function quantityRange(product: QuantityRule) {
  const min = positive(product.minQuantity);
  return { min, max: Math.max(min, positive(product.maxQuantity)) };
}

// Seletor de quantidade só aparece quando o produto permite mais de 1.
export const allowsQuantity = (product: QuantityRule) => quantityRange(product).max > 1;

export function assertCheckoutQuantity(product: QuantityRule, quantity: number | undefined) {
  const { min, max } = quantityRange(product);
  const value = quantity ?? 1;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new CheckoutQuantityError(min, max);
  return value;
}

export function orderTotalCents(unitPriceCents: number, quantity: number) {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 1) throw new Error("INVALID_UNIT_PRICE");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("INVALID_QUANTITY");
  return unitPriceCents * quantity;
}

// "5 × R$ 14,90" quando há mais de uma unidade; senão só o preço.
export function quantityPriceLabel(quantity: number | null | undefined, unitPriceLabel: string) {
  return quantity && quantity > 1 ? `${quantity} × ${unitPriceLabel}` : unitPriceLabel;
}
