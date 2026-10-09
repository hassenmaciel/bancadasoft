import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { audit } from "./audit";
import { executeFulfillment, safeErrorInfo } from "./fulfillment-engine";
import { createConfiguredAsaasProvider, type AsaasPaymentSnapshot } from "./payments/asaas";
import { PaymentProviderNotConnectedError } from "./payments/types";
import {
  asaasPaymentMismatch,
  paymentReconcileBlocker,
  paymentReconcileEventId,
  paymentReconcileNote,
  type PaymentReconcileErrorCode,
} from "./payment-reconcile-rules";

export class PaymentReconcileError extends Error {
  constructor(public readonly code: PaymentReconcileErrorCode) {
    super(code);
    this.name = "PaymentReconcileError";
  }
}

type ReconcileDeps = {
  client: Pick<typeof prisma, "order" | "$transaction">;
  asaas: () => { getPayment(externalPaymentId: string): Promise<AsaasPaymentSnapshot> };
  // A MESMA função que o webhook (processPayment) chama depois de PAID.
  fulfill: (orderId: string) => Promise<unknown>;
  log: (message: string, context: Record<string, unknown>) => void;
};

const defaultDeps: ReconcileDeps = {
  client: prisma,
  asaas: createConfiguredAsaasProvider,
  fulfill: (orderId) => executeFulfillment(orderId),
  log: (message, context) => console.error(message, context),
};

const orderSelect = {
  status: true,
  publicToken: true,
  payment: {
    select: { id: true, provider: true, status: true, externalPaymentId: true, amountCents: true },
  },
} as const;

// Reconciliação manual quando o webhook do Asaas não chegou. Não passa pelo
// caminho do webhook (processPayment): consulta GET /payments/{id} e grava a
// mesma transição (Payment/Order PAID + PaymentEvent + OrderEvent) com claim
// atômico. Um webhook real que chegue depois encontra o Payment já PAID e não
// inicia outro fulfillment; a reconciliação depois do webhook é recusada.
export async function reconcileAsaasPayment(
  input: { orderId: string; adminId: string },
  deps: Partial<ReconcileDeps> = {},
) {
  const { client, asaas, fulfill, log } = { ...defaultDeps, ...deps };
  const { orderId, adminId } = input;

  // 1) Pré-leitura (nada gravado): evita consultar o Asaas à toa.
  const before = await client.order.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!before) throw new PaymentReconcileError("ORDER_NOT_FOUND");
  const blocker = paymentReconcileBlocker({ orderStatus: before.status, payment: before.payment });
  if (blocker) throw new PaymentReconcileError(blocker);
  const payment = before.payment!;
  const externalPaymentId = payment.externalPaymentId!;

  // 2) Consulta ao Asaas FORA da transação (nunca segurar transação em rede).
  let snapshot: AsaasPaymentSnapshot;
  try {
    snapshot = await asaas().getPayment(externalPaymentId);
  } catch (error) {
    if (error instanceof PaymentProviderNotConnectedError)
      throw new PaymentReconcileError("ASAAS_NOT_CONFIGURED");
    log("[admin] reconcile-payment: consulta ao Asaas falhou.", {
      orderId,
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
    });
    throw new PaymentReconcileError("ASAAS_UNAVAILABLE");
  }
  const expected = { externalPaymentId, publicToken: before.publicToken, amountCents: payment.amountCents };
  const mismatch = asaasPaymentMismatch(snapshot, expected);
  if (mismatch) throw new PaymentReconcileError(mismatch);

  // 3) Transição: pré-condições relidas aqui dentro + claim atômico. Só quem
  // vence o claim grava; o perdedor tem a transação inteira desfeita.
  let previousPaymentStatus: PaymentStatus;
  try {
    previousPaymentStatus = await client.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
      if (!current) throw new PaymentReconcileError("ORDER_NOT_FOUND");
      const currentBlocker = paymentReconcileBlocker({ orderStatus: current.status, payment: current.payment });
      if (currentBlocker) throw new PaymentReconcileError(currentBlocker);
      const currentPayment = current.payment!;
      // A cobrança, a referência ou o valor mudaram entre a consulta e a transação.
      const changed = asaasPaymentMismatch(snapshot, {
        externalPaymentId: currentPayment.externalPaymentId!,
        publicToken: current.publicToken,
        amountCents: currentPayment.amountCents,
      });
      if (changed) throw new PaymentReconcileError("CONCURRENT_RECONCILE");

      const claim = await tx.payment.updateMany({
        where: {
          id: currentPayment.id,
          externalPaymentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.EXPIRED] },
        },
        data: { status: PaymentStatus.PAID },
      });
      if (claim.count !== 1) throw new PaymentReconcileError("CONCURRENT_RECONCILE");
      const orderClaim = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.PAID },
      });
      if (orderClaim.count !== 1) throw new PaymentReconcileError("CONCURRENT_RECONCILE");

      await tx.paymentEvent.create({
        data: {
          providerEventId: paymentReconcileEventId(externalPaymentId),
          paymentId: currentPayment.id,
          payload: {
            source: "admin-manual-reconcile",
            adminId,
            previousPaymentStatus: currentPayment.status,
            asaas: { id: snapshot.id, status: snapshot.status, value: snapshot.value, externalReference: snapshot.externalReference },
          },
        },
      });
      await tx.orderEvent.create({
        data: { orderId, status: OrderStatus.PAID, note: paymentReconcileNote(currentPayment.status) },
      });
      await audit(
        adminId,
        "PAYMENT_MANUAL_RECONCILE",
        "Order",
        orderId,
        {
          externalPaymentId,
          previousPaymentStatus: currentPayment.status,
          asaasStatus: snapshot.status,
          amountCents: currentPayment.amountCents,
          manualReview: currentPayment.status === PaymentStatus.EXPIRED,
        },
        tx,
      );
      return currentPayment.status;
    });
  } catch (error) {
    // PaymentEvent sintético já existente (P2002) ou conflito de escrita (P2034):
    // outra reconciliação/webhook mexeu no pagamento ao mesmo tempo.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    )
      throw new PaymentReconcileError("CONCURRENT_RECONCILE");
    throw error;
  }

  // 4) Fulfillment fora da transação, igual ao webhook: PAID continua
  // confirmado mesmo se a execução falhar; a falha fica visível em log.
  let fulfillment: "EXECUTED" | "FAILED" = "EXECUTED";
  try {
    await fulfill(orderId);
  } catch (error) {
    fulfillment = "FAILED";
    log("[fulfillment] Execução falhou após reconciliação manual do pagamento.", {
      orderId,
      ...safeErrorInfo(error),
    });
  }
  return {
    status: "RECONCILED" as const,
    previousPaymentStatus,
    manualReview: previousPaymentStatus === PaymentStatus.EXPIRED,
    fulfillment,
  };
}
