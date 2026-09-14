export const ADCLEAN_TICKET_DURATION_HOURS = 168;

export function adcleanIdempotencyKey(orderId: string) {
  if (!orderId.trim()) throw new Error("ADCLEAN_ORDER_ID_REQUIRED");
  return `bancadasoft:${orderId}`;
}

export function buildAdcleanTicketContract(orderId: string, paidAmountCents: number) {
  if (!Number.isInteger(paidAmountCents) || paidAmountCents < 1)
    throw new Error("ADCLEAN_PAID_AMOUNT_REQUIRED");
  return {
    duracao_horas: ADCLEAN_TICKET_DURATION_HOURS,
    valor_centavos: paidAmountCents,
    idempotency_key: adcleanIdempotencyKey(orderId),
    external_order_id: orderId,
    partner: "bancadasoft" as const,
  };
}
