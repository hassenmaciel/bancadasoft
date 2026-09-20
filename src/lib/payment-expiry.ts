import { OrderStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { getPaymentProvider } from "./payments/registry";
import { isPixExpired } from "./payments/pix-expiry";
import type { PaymentCancelResult } from "./payments/types";

export type PixExpiryOutcome = "NOT_DUE" | "ALREADY_HANDLED" | "EXPIRED";

const cancelNote: Record<PaymentCancelResult | "UNAVAILABLE", string> = {
  CANCELLED: "cobrança cancelada no provedor.",
  ALREADY_GONE: "cobrança já não existia no provedor.",
  REJECTED: "provedor recusou o cancelamento — REVISÃO MANUAL.",
  UNCERTAIN: "cancelamento no provedor ficou incerto (sem nova tentativa) — REVISÃO MANUAL.",
  UNAVAILABLE: "provedor sem suporte a cancelamento — REVISÃO MANUAL.",
};

// Expira o PIX vencido pelo relógio do SERVIDOR. Só o processo que vencer o
// claim atômico (PENDING -> EXPIRED) cancela a cobrança no provedor, então o
// cancelamento roda no máximo uma vez e nunca é repetido às cegas: um erro
// ambíguo apenas fica registrado no pedido. Um pagamento que ainda chegue para
// uma cobrança expirada é tratado como pago (ver processPayment).
export async function expirePixIfDue(orderId: string, now: Date = new Date()): Promise<PixExpiryOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { orderId },
    select: { id: true, provider: true, status: true, externalPaymentId: true, expiresAt: true },
  });
  if (
    !payment ||
    payment.status !== PaymentStatus.PENDING ||
    !payment.externalPaymentId ||
    !isPixExpired(payment.expiresAt, now.getTime())
  )
    return "NOT_DUE";

  const claimed = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: PaymentStatus.PENDING,
      externalPaymentId: payment.externalPaymentId,
      expiresAt: { lte: now },
    },
    data: { status: PaymentStatus.EXPIRED },
  });
  if (claimed.count !== 1) return "ALREADY_HANDLED";

  const provider = getPaymentProvider(payment.provider);
  let result: PaymentCancelResult | "UNAVAILABLE" = "UNAVAILABLE";
  if (provider?.cancelPayment) {
    try {
      result = await provider.cancelPayment(payment.externalPaymentId);
    } catch {
      result = "UNCERTAIN";
    }
  }
  await prisma.orderEvent.create({
    data: {
      orderId,
      status: OrderStatus.PENDING_PAYMENT,
      note: `PIX expirado (30 min); ${cancelNote[result]}`,
    },
  });
  return "EXPIRED";
}
