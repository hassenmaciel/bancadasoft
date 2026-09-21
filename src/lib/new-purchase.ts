// Estado local do "Fazer nova compra": só o navegador é tocado — nenhuma API,
// nenhum pedido/pagamento/entrega no banco é alterado.

type Removable = Pick<Storage, "removeItem">;

// O botão só existe na tela de entrega (pedido DELIVERED com a entrega já
// carregada). Em PENDING_PAYMENT — inclusive com o PIX expirado, onde a ação
// é "Gerar novo PIX" — e em qualquer estado sem entrega ele não aparece.
export const showNewPurchaseButton = (orderStatus: string | null | undefined, hasDelivery: boolean) =>
  orderStatus === "DELIVERED" && hasDelivery;

// Esquece apenas a referência do pedido guardado deste produto. Não remove o
// token de entrega (`bancadasoft:delivery:<id>`), que a página /acompanhar
// continua usando para o link "Acompanhar pedido em página separada".
export function clearStoredCheckout(storage: Removable, storageKey: string) {
  storage.removeItem(storageKey);
}

// "Cancelar e começar de novo": só com PIX válido aguardando pagamento. Nunca em
// PAID, PROCESSING nem DELIVERED (pedido já pago/entregue não pode ser cancelado).
export const showCancelPixButton = (
  orderStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
) => orderStatus === "PENDING_PAYMENT" && paymentStatus === "PENDING";

// Com o PIX expirado, "Fazer nova compra" aparece ao lado de "Gerar novo PIX".
export const showNewPurchaseAfterExpiry = (
  orderStatus: string | null | undefined,
  paymentStatus: string | null | undefined,
) => orderStatus === "PENDING_PAYMENT" && (paymentStatus === "EXPIRED" || paymentStatus === "PENDING");

export const PIX_CANCEL_WARNING = "Se você já pagou, não cancele: aguarde a confirmação.";
export const PIX_CANCEL_REVIEW_MESSAGE =
  "Não conseguimos cancelar o PIX antigo automaticamente. Não pague o código antigo; se já pagou, aguarde: confirmaremos o pagamento. Você pode gerar um novo PIX ou fazer uma nova compra.";
