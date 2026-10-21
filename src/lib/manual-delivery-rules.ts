// Regras puras da "entrega manual" do Admin: o operador entregou o acesso ao
// cliente FORA do sistema (ex.: comprou manualmente no painel do fornecedor)
// e só precisa registrar isso. Sem Prisma aqui — a mesma regra decide a
// visibilidade do botão (página do Admin) e é revalidada dentro da transação
// (admin-manual-delivery.ts) contra o estado lido no banco.

// Mesmo valor de HEARTUNLOCKS_CODE (providers/heartunlocks.ts), repetido aqui
// porque este módulo vai para o bundle do cliente (manual-delivery-button.tsx).
export const MANUAL_DELIVERY_HEARTUNLOCKS_CODE = "heartunlocks";

export const MANUAL_DELIVERY_REASON_MIN = 10;
export const MANUAL_DELIVERY_REASON_MAX = 500;

// Entrega gravada no Fulfillment: só texto informativo, NUNCA credencial de
// provedor. Formato TEXT com instructions é aceito por customerDelivery
// (customer-delivery.ts) — o cliente vê a mensagem e o polling encerra.
export const MANUAL_DELIVERY_PAYLOAD = Object.freeze({
  deliveryType: "TEXT",
  title: "Entrega manual",
  instructions: "Seu acesso foi entregue pelo suporte da BancadaSoft.",
});

// Evento visível ao cliente (histórico em /meus-pedidos).
export const MANUAL_DELIVERY_CUSTOMER_NOTE = "Entrega registrada pelo suporte.";

// Evento interno: o prefixo "REVISÃO MANUAL" faz customerVisibleEvents (dto.ts)
// esconder do cliente o motivo digitado pelo operador.
export const manualDeliveryInternalNote = (reason: string) =>
  `REVISÃO MANUAL: entrega manual registrada pelo Admin. Motivo: ${reason}`;

// Motivo de auditoria quando o fornecedor ainda estava em PROCESSING.
export const MANUAL_DELIVERY_PROCESSING_AUDIT_NOTE =
  "entrega manual com fornecedor em PROCESSING";
export const MANUAL_DELIVERY_FINALIZED_AUDIT_NOTE =
  "finalizado pela entrega manual pelo admin, após conferência prévia no painel do fornecedor; conclusão do fornecedor não verificada automaticamente pelo sistema";

export type ManualDeliveryBlocker =
  | "PAYMENT_NOT_PAID"
  | "ORDER_ALREADY_DELIVERED"
  | "ORDER_CANCELLED"
  | "PROVIDER_ORDER_PROCESSING"
  | "PROVIDER_ORDER_COMPLETED"
  | "DELIVERY_ALREADY_EXISTS";

export type ManualDeliveryProviderOrder = {
  providerCode: string;
  status: string;
  lastError: string | null;
  externalOrderId: string | null;
  callbackEventCount: number;
};

export type ManualDeliveryState = {
  paymentStatus?: string | null;
  orderStatus: string;
  hasDelivery: boolean;
  providerOrders: ManualDeliveryProviderOrder[];
};

// HeartUnlocks em PROCESSING sem callback: envio incerto (timeout/erro do
// gateway) ou aceito pelo fornecedor (externalOrderId) aguardando o callback.
// Único PROCESSING que não bloqueia — um callback tardio encontra a Delivery e
// não sobrescreve (heartunlocks-callback.ts). Sem lastError e sem
// externalOrderId é criação em andamento: continua bloqueado. É também o único
// ProviderOrder que a entrega manual finaliza como COMPLETED.
export const heartUnlocksAwaitingCallback = (item: ManualDeliveryProviderOrder) =>
  item.providerCode === MANUAL_DELIVERY_HEARTUNLOCKS_CODE &&
  item.status === "PROCESSING" &&
  item.callbackEventCount === 0 &&
  (item.lastError === "PROVIDER_RESULT_UNCERTAIN" || Boolean(item.externalOrderId));

export function manualDeliveryBlocker(
  state: ManualDeliveryState,
): ManualDeliveryBlocker | null {
  if (state.paymentStatus !== "PAID") return "PAYMENT_NOT_PAID";
  if (state.orderStatus === "DELIVERED") return "ORDER_ALREADY_DELIVERED";
  if (state.orderStatus === "CANCELLED") return "ORDER_CANCELLED";
  // PROCESSING: o fornecedor ainda pode concluir sozinho (callback/reconciliação)
  // — registrar entrega manual agora arriscaria entregar duas vezes.
  if (
    state.providerOrders.some(
      (item) => item.status === "PROCESSING" && !heartUnlocksAwaitingCallback(item),
    )
  )
    return "PROVIDER_ORDER_PROCESSING";
  if (state.providerOrders.some((item) => item.status === "COMPLETED"))
    return "PROVIDER_ORDER_COMPLETED";
  if (state.hasDelivery) return "DELIVERY_ALREADY_EXISTS";
  return null;
}

export const MANUAL_DELIVERY_ERROR_MESSAGES: Record<
  ManualDeliveryBlocker | "INVALID_REASON" | "ORDER_NOT_FOUND" | "CONCURRENT_MANUAL_DELIVERY",
  string
> = {
  INVALID_REASON: `Informe o motivo (${MANUAL_DELIVERY_REASON_MIN} a ${MANUAL_DELIVERY_REASON_MAX} caracteres).`,
  ORDER_NOT_FOUND: "Pedido não encontrado.",
  PAYMENT_NOT_PAID: "O pagamento deste pedido não está confirmado.",
  ORDER_ALREADY_DELIVERED: "Este pedido já está entregue.",
  ORDER_CANCELLED: "Este pedido está cancelado.",
  PROVIDER_ORDER_PROCESSING:
    "O fornecedor ainda está processando este pedido. Aguarde o resultado.",
  PROVIDER_ORDER_COMPLETED: "O fornecedor já concluiu este pedido.",
  DELIVERY_ALREADY_EXISTS: "Este pedido já possui uma entrega registrada.",
  CONCURRENT_MANUAL_DELIVERY:
    "O pedido mudou durante o registro. Atualize a página e confira.",
};
