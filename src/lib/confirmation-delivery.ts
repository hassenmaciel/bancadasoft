// Produtos de confirmação (ex.: créditos Phoenix): o "success" do fornecedor
// sem retorno textual já é a entrega. Opt-in por Product.acceptsSuccessWithoutText
// (a sync do catálogo não toca em Product, ao contrário do fieldSchema e do
// expectedDeliveryType do ProviderProduct). A licença UnlockTool continua no
// critério próprio (acceptsLicenseSuccessWithoutText), sem mudança.
import { orderItemFieldEcho, type EchoOrderItem } from "./customer-field-echo";

export type ConfirmationSubject = { acceptsSuccessWithoutText?: boolean | null };

export const acceptsConfirmationSuccess = (product: ConfirmationSubject | null | undefined) =>
  product?.acceptsSuccessWithoutText === true;

export const confirmationInstructions = (quantity: number | null | undefined) =>
  quantity && quantity > 1
    ? `O fornecedor confirmou a adição de ${quantity} créditos na conta informada no pedido.`
    : "O fornecedor confirmou o pedido na conta informada.";

export const CONFIRMATION_SUCCESS_MANUAL_REVIEW_NOTE =
  "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir os créditos no painel do fornecedor.";

// Prova de entrega: a conta que o cliente digitou, pelo mesmo eco da tela
// (só campos customerVisible, não sensíveis, nunca quantity). Um campo ecoado:
// usa esse; vários: só se exatamente um for de conta. Senão null (não adivinha).
const ACCOUNT_KEYS = new Set(["email", "username", "login", "account"]);
export function confirmationAccount(item: EchoOrderItem | null | undefined) {
  if (!item) return null;
  const echo = orderItemFieldEcho(item);
  const candidates = echo.length === 1 ? echo : echo.filter((field) => ACCOUNT_KEYS.has(field.key));
  return candidates.length === 1 ? candidates[0].value : null;
}

// Quantidade efetivamente enviada ao fornecedor: providerFields sob o
// providerFieldName do campo quantity do mesmo fieldSchema do eco.
function sentQuantity(item: EchoOrderItem) {
  const schema = item.providerProduct?.fieldSchema ?? item.productVariant?.providerProduct?.fieldSchema;
  if (!Array.isArray(schema) || !item.providerFields || typeof item.providerFields !== "object") return null;
  const field = schema.find(
    (entry) => entry && typeof entry === "object" && ((entry as { key?: unknown }).key === "quantity" || (entry as { type?: unknown }).type === "quantity"),
  ) as { providerFieldName?: unknown } | undefined;
  if (typeof field?.providerFieldName !== "string") return null;
  const raw = (item.providerFields as Record<string, unknown>)[field.providerFieldName];
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : null;
  return value !== null && Number.isInteger(value) ? value : null;
}

// Só cita o que foi enviado: N (OrderItem.quantity) entra apenas se for igual
// ao Quantity enviado; sem conta ou com divergência, o texto genérico de antes.
function proofInstructions(quantity: number | null | undefined, item: EchoOrderItem | null | undefined) {
  if (!item || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) return null;
  const account = confirmationAccount(item);
  if (!account || sentQuantity(item) !== quantity) return null;
  return quantity > 1
    ? `O fornecedor confirmou o pedido de ${quantity} créditos para a conta ${account}.`
    : `O fornecedor confirmou o pedido para a conta ${account}.`;
}

// TEXT só com instructions: aceito por customerDelivery, exibido como
// "Resultado disponível" junto do echo dos campos do cliente. O marcador
// confirmation (ignorado por customerDelivery) seleciona o e-mail de
// confirmação de créditos (delivery-email.ts).
export const confirmationDelivery = (
  product: { name: string },
  quantity: number | null | undefined,
  item?: EchoOrderItem | null,
) => ({
  kind: "provider-delivery",
  deliveryType: "TEXT" as const,
  title: product.name,
  instructions: proofInstructions(quantity, item) ?? confirmationInstructions(quantity),
  confirmation: true as const,
});
