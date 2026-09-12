import { PaymentStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { getPaymentProvider } from "./payments/registry";
import type { PaymentProvider, PixPaymentDetails } from "./payments/types";

type PendingPayment = {
  id: string;
  orderId: string;
  provider: string;
  status: PaymentStatus;
  externalPaymentId: string | null;
  pixCode: string;
};

type ReconciliationDeps = {
  findPayment: (orderId: string) => Promise<PendingPayment | null>;
  providerFor: (code: string) => PaymentProvider | null;
  persist: (payment: PendingPayment, details: PixPaymentDetails) => Promise<void>;
};

const defaultDeps: ReconciliationDeps = {
  findPayment: (orderId) =>
    prisma.payment.findUnique({
      where: { orderId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        status: true,
        externalPaymentId: true,
        pixCode: true,
      },
    }),
  providerFor: getPaymentProvider,
  persist: async (payment, details) => {
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          pixCode: details.pixCode,
          qrCode: details.qrCode,
          expiresAt: details.expiresAt,
        },
      }),
      prisma.orderEvent.create({
        data: {
          orderId: payment.orderId,
          status: "PENDING_PAYMENT",
          note: "PIX Asaas reconciliado com a cobrança existente.",
        },
      }),
    ]);
  },
};

export async function reconcilePendingPixPayment(
  orderId: string,
  deps: ReconciliationDeps = defaultDeps,
) {
  const payment = await deps.findPayment(orderId);
  if (!payment) return { status: "NOT_FOUND" as const };
  if (payment.pixCode) return { status: "ALREADY_AVAILABLE" as const };
  if (
    payment.provider !== "asaas" ||
    payment.status !== PaymentStatus.PENDING ||
    !payment.externalPaymentId
  )
    return { status: "NOT_RECOVERABLE" as const };

  const provider = deps.providerFor(payment.provider);
  if (!provider?.getPixPaymentDetails)
    return { status: "PROVIDER_UNAVAILABLE" as const };
  const details = await provider.getPixPaymentDetails(payment.externalPaymentId);
  await deps.persist(payment, details);
  return { status: "RECONCILED" as const };
}
