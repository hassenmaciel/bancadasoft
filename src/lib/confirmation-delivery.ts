// Produtos de confirmação (ex.: créditos Phoenix): o "success" do fornecedor
// sem retorno textual já é a entrega. Opt-in por Product.acceptsSuccessWithoutText
// (a sync do catálogo não toca em Product, ao contrário do fieldSchema e do
// expectedDeliveryType do ProviderProduct). A licença UnlockTool continua no
// critério próprio (acceptsLicenseSuccessWithoutText), sem mudança.
export type ConfirmationSubject = { acceptsSuccessWithoutText?: boolean | null };

export const acceptsConfirmationSuccess = (product: ConfirmationSubject | null | undefined) =>
  product?.acceptsSuccessWithoutText === true;

export const confirmationInstructions = (quantity: number | null | undefined) =>
  quantity && quantity > 1
    ? `O fornecedor confirmou a adição de ${quantity} créditos na conta informada no pedido.`
    : "O fornecedor confirmou o pedido na conta informada.";

export const CONFIRMATION_SUCCESS_MANUAL_REVIEW_NOTE =
  "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir os créditos no painel do fornecedor.";

// TEXT só com instructions: aceito por customerDelivery, exibido como
// "Resultado disponível" junto do echo dos campos do cliente.
export const confirmationDelivery = (product: { name: string }, quantity: number | null | undefined) => ({
  kind: "provider-delivery",
  deliveryType: "TEXT" as const,
  title: product.name,
  instructions: confirmationInstructions(quantity),
});
