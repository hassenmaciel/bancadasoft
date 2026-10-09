// Regras puras da reconciliação manual de pagamento com o Asaas. Sem prisma:
// usadas pelo servidor (dentro e fora da transação) e pela tela do admin.

export type PaymentReconcileBlocker =
  | "NO_PAYMENT"
  | "NOT_ASAAS"
  | "NO_EXTERNAL_PAYMENT"
  | "PAYMENT_ALREADY_PAID"
  | "PAYMENT_NOT_RECONCILABLE"
  | "ORDER_NOT_PENDING_PAYMENT";

export type AsaasPaymentMismatch =
  | "ASAAS_NOT_RECEIVED"
  | "ASAAS_ID_MISMATCH"
  | "ASAAS_REFERENCE_MISMATCH"
  | "ASAAS_VALUE_MISMATCH";

export type PaymentReconcileErrorCode =
  | PaymentReconcileBlocker
  | AsaasPaymentMismatch
  | "ORDER_NOT_FOUND"
  | "ASAAS_NOT_CONFIGURED"
  | "ASAAS_UNAVAILABLE"
  | "CONCURRENT_RECONCILE";

export const PAYMENT_RECONCILE_EVENT_PREFIX = "manual-reconcile:";
export const paymentReconcileEventId = (externalPaymentId: string) =>
  `${PAYMENT_RECONCILE_EVENT_PREFIX}${externalPaymentId}`;

export const PAYMENT_RECONCILE_CONFIRM_TEXT =
  "Isso consulta o Asaas e, se o pagamento estiver recebido, libera o pedido. Use só se o cliente já pagou.";

export const PAYMENT_RECONCILE_ERROR_MESSAGES: Record<PaymentReconcileErrorCode, string> = {
  ORDER_NOT_FOUND: "Pedido não encontrado.",
  NO_PAYMENT: "O pedido não tem pagamento.",
  NOT_ASAAS: "O pagamento deste pedido não é do Asaas.",
  NO_EXTERNAL_PAYMENT: "O pagamento não tem cobrança no Asaas vinculada.",
  PAYMENT_ALREADY_PAID: "O pagamento já está confirmado (PAID). Nada foi alterado.",
  PAYMENT_NOT_RECONCILABLE: "O pagamento não está PENDING nem EXPIRED. Nada foi alterado.",
  ORDER_NOT_PENDING_PAYMENT: "O pedido não está aguardando pagamento. Nada foi alterado.",
  ASAAS_NOT_RECEIVED: "O Asaas ainda não mostra esta cobrança como recebida (RECEIVED). Nada foi alterado.",
  ASAAS_ID_MISMATCH: "A cobrança devolvida pelo Asaas não é a vinculada ao pedido. Nada foi alterado.",
  ASAAS_REFERENCE_MISMATCH: "A referência externa da cobrança no Asaas não é a deste pedido. Nada foi alterado.",
  ASAAS_VALUE_MISMATCH: "O valor da cobrança no Asaas é diferente do valor do pedido. Nada foi alterado.",
  ASAAS_NOT_CONFIGURED: "O Asaas não está configurado neste ambiente. Nada foi alterado.",
  ASAAS_UNAVAILABLE: "Não foi possível consultar o Asaas agora. Nada foi alterado; tente de novo.",
  CONCURRENT_RECONCILE: "O pagamento foi alterado ao mesmo tempo por outra operação (webhook ou outro clique). Nada foi gravado por esta ação.",
};

export function paymentReconcileBlocker(input: {
  orderStatus: string;
  payment: { provider: string; status: string; externalPaymentId: string | null } | null | undefined;
}): PaymentReconcileBlocker | null {
  const { payment } = input;
  if (!payment) return "NO_PAYMENT";
  if (payment.provider !== "asaas") return "NOT_ASAAS";
  if (!payment.externalPaymentId) return "NO_EXTERNAL_PAYMENT";
  if (payment.status === "PAID") return "PAYMENT_ALREADY_PAID";
  if (payment.status !== "PENDING" && payment.status !== "EXPIRED") return "PAYMENT_NOT_RECONCILABLE";
  if (input.orderStatus !== "PENDING_PAYMENT") return "ORDER_NOT_PENDING_PAYMENT";
  return null;
}

// Só RECEIVED libera (CONFIRMED não é o fluxo do PIX e o webhook também não o trata).
export function asaasPaymentMismatch(
  asaas: { id: string; status: string; value: number; externalReference: string | null },
  expected: { externalPaymentId: string; publicToken: string; amountCents: number },
): AsaasPaymentMismatch | null {
  if (asaas.id !== expected.externalPaymentId) return "ASAAS_ID_MISMATCH";
  if (asaas.status !== "RECEIVED") return "ASAAS_NOT_RECEIVED";
  if (asaas.externalReference !== expected.publicToken) return "ASAAS_REFERENCE_MISMATCH";
  if (Math.round(asaas.value * 100) !== expected.amountCents) return "ASAAS_VALUE_MISMATCH";
  return null;
}

export const paymentReconcileNote = (previousPaymentStatus: string) =>
  previousPaymentStatus === "EXPIRED"
    ? "Pagamento Asaas confirmado por reconciliação manual do admin (consulta ao Asaas: RECEIVED) APÓS a expiração do PIX — REVISÃO MANUAL necessária."
    : "Pagamento Asaas confirmado por reconciliação manual do admin (consulta ao Asaas: RECEIVED).";
