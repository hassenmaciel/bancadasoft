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
