import { OrderStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { getPaymentProvider } from "./payments/registry";
import { PIX_LEGACY_GRACE_MS, PIX_VALIDITY_MS, isLegacyPixExpiry, isPixExpired } from "./payments/pix-expiry";
import type { PaymentCancelResult } from "./payments/types";

export type PixExpiryOutcome = "NOT_DUE" | "ALREADY_HANDLED" | "EXPIRED";
export type PixCancelOutcome = "NOT_PENDING" | "ALREADY_HANDLED" | "CANCELLED" | "MANUAL_REVIEW";

const cancelNote: Record<PaymentCancelResult | "UNAVAILABLE", string> = {
  CANCELLED: "cobrança cancelada no provedor.",
  ALREADY_GONE: "cobrança já não existia no provedor.",
  REJECTED: "provedor recusou o cancelamento — REVISÃO MANUAL.",
  UNCERTAIN: "cancelamento no provedor ficou incerto (sem nova tentativa) — REVISÃO MANUAL.",
  UNAVAILABLE: "provedor sem suporte a cancelamento — REVISÃO MANUAL.",
};
const needsReview = (result: PaymentCancelResult | "UNAVAILABLE") =>
  result === "REJECTED" || result === "UNCERTAIN" || result === "UNAVAILABLE";

type PendingPayment = { id: string; provider: string; externalPaymentId: string };

// Caminho único de expiração: o claim atômico (PENDING -> EXPIRED) decide quem
// cancela a cobrança no provedor, então o DELETE roda no máximo uma vez e nunca
// é repetido às cegas. `guard` restringe o claim ao motivo que o originou.
async function claimAndCancel(
  orderId: string,
  payment: PendingPayment,
  guard: Record<string, unknown>,
  reason: string,
): Promise<{ claimed: false } | { claimed: true; result: PaymentCancelResult | "UNAVAILABLE" }> {
  const claimed = await prisma.payment.updateMany({
    where: {
      id: payment.id,
      status: PaymentStatus.PENDING,
      externalPaymentId: payment.externalPaymentId,
      ...guard,
    },
    data: { status: PaymentStatus.EXPIRED },
  });
  if (claimed.count !== 1) return { claimed: false };

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
    data: { orderId, status: OrderStatus.PENDING_PAYMENT, note: `${reason}; ${cancelNote[result]}` },
  });
  return { claimed: true, result };
}

// Expira o PIX vencido pelo relógio do SERVIDOR. Um PIX legado (expiresAt além de
// agora + validade + tolerância, ex.: 1 ano do provedor) é tratado como vencido
// pelo mesmo caminho, só quando o pedido é consultado. Um pagamento que ainda
// chegue para uma cobrança expirada é tratado como pago (ver processPayment).
export async function expirePixIfDue(orderId: string, now: Date = new Date()): Promise<PixExpiryOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { orderId },
    select: { id: true, provider: true, status: true, externalPaymentId: true, expiresAt: true },
  });
  if (!payment || payment.status !== PaymentStatus.PENDING || !payment.externalPaymentId) return "NOT_DUE";
  const legacy = isLegacyPixExpiry(payment.expiresAt, now.getTime());
  if (!legacy && !isPixExpired(payment.expiresAt, now.getTime())) return "NOT_DUE";

  const outcome = await claimAndCancel(
    orderId,
    { id: payment.id, provider: payment.provider, externalPaymentId: payment.externalPaymentId },
    legacy
      ? { expiresAt: { gt: new Date(now.getTime() + PIX_VALIDITY_MS + PIX_LEGACY_GRACE_MS) } }
      : { expiresAt: { lte: now } },
    legacy ? "PIX legado (validade fora do padrão) tratado como expirado" : "PIX expirado (30 min)",
  );
  return outcome.claimed ? "EXPIRED" : "ALREADY_HANDLED";
}

// "Cancelar e começar de novo": força a expiração pelo mesmo fluxo. Só age em
// Payment PENDING de pedido PENDING_PAYMENT; o Order continua PENDING_PAYMENT.
// Idempotente: repetir o pedido (ou cliques concorrentes) cancela no máximo uma
// vez no provedor. Recusa/erro ambíguo do provedor NÃO é sucesso: fica
// MANUAL_REVIEW (registrado como REVISÃO MANUAL) e o cliente é avisado.
export async function cancelPixByCustomer(orderId: string): Promise<PixCancelOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, payment: { select: { id: true, provider: true, status: true, externalPaymentId: true } } },
  });
  const payment = order?.payment;
  if (!order || !payment || order.status !== OrderStatus.PENDING_PAYMENT) return "NOT_PENDING";
  if (payment.status === PaymentStatus.EXPIRED) return "ALREADY_HANDLED";
  if (payment.status !== PaymentStatus.PENDING || !payment.externalPaymentId) return "NOT_PENDING";

  const outcome = await claimAndCancel(
    orderId,
    { id: payment.id, provider: payment.provider, externalPaymentId: payment.externalPaymentId },
    {},
    "PIX cancelado pelo cliente (começar de novo)",
  );
  if (!outcome.claimed) return "ALREADY_HANDLED";
  return needsReview(outcome.result) ? "MANUAL_REVIEW" : "CANCELLED";
}
