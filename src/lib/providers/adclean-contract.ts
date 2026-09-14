export const ADCLEAN_TICKET_DURATION_HOURS = 168;

export function adcleanIdempotencyKey(orderId: string) {
  const normalized = orderId.trim();
  if (!normalized) throw new Error("ADCLEAN_ORDER_ID_REQUIRED");
  return `bancadasoft:${normalized}`;
}

export function buildAdcleanTicketContract(
  orderId: string,
  paidAmountCents: number,
) {
  if (!Number.isInteger(paidAmountCents) || paidAmountCents < 1)
    throw new Error("ADCLEAN_PAID_AMOUNT_REQUIRED");
  const externalOrderId = orderId.trim();
  return {
    duracao_horas: ADCLEAN_TICKET_DURATION_HOURS,
    valor: paidAmountCents / 100,
    expira_em_dias: null,
    idempotency_key: adcleanIdempotencyKey(externalOrderId),
    external_order_id: externalOrderId,
    partner: "bancadasoft" as const,
  };
}
