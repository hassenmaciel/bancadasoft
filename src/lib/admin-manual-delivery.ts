import { FulfillmentStatus, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { audit } from "./audit";
import {
  MANUAL_DELIVERY_CUSTOMER_NOTE,
  MANUAL_DELIVERY_PAYLOAD,
  manualDeliveryBlocker,
  manualDeliveryInternalNote,
  type ManualDeliveryBlocker,
} from "./manual-delivery-rules";

export type ManualDeliveryErrorCode =
  | ManualDeliveryBlocker
  | "ORDER_NOT_FOUND"
  | "CONCURRENT_MANUAL_DELIVERY";

export class ManualDeliveryError extends Error {
  constructor(public readonly code: ManualDeliveryErrorCode) {
    super(code);
    this.name = "ManualDeliveryError";
  }
}

type ManualDeliveryClient = Pick<typeof prisma, "$transaction">;

// Registra que o acesso foi entregue FORA do sistema. Nunca chama fornecedor,
// nunca envia e-mail e nunca toca no ProviderOrder (o histórico real do
// fornecedor — ex.: PROVIDER_REJECTED — é preservado).
//
// Tudo numa única transação: pré-condições relidas aqui dentro e claim
// atômico (updateMany condicionado ao status lido). Duas chamadas
// simultâneas leem o mesmo status, mas só uma consegue o claim do Order — a
// outra recebe count 0 e a transação inteira é desfeita.
export async function registerManualDelivery(
  input: { orderId: string; adminId: string; reason: string },
  client: ManualDeliveryClient = prisma,
) {
  const { orderId, adminId, reason } = input;
  try {
    return await client.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          status: true,
          payment: { select: { status: true } },
          fulfillment: { select: { id: true, status: true, delivery: true } },
          providerOrders: { select: { status: true } },
        },
      });
      if (!order) throw new ManualDeliveryError("ORDER_NOT_FOUND");
      const blocker = manualDeliveryBlocker({
        paymentStatus: order.payment?.status,
        orderStatus: order.status,
        hasDelivery: Boolean(order.fulfillment?.delivery),
        providerOrderStatuses: order.providerOrders.map((item) => item.status),
      });
      if (blocker) throw new ManualDeliveryError(blocker);

      const orderClaim = await tx.order.updateMany({
        where: { id: orderId, status: order.status },
        data: { status: OrderStatus.DELIVERED },
      });
      if (orderClaim.count !== 1)
        throw new ManualDeliveryError("CONCURRENT_MANUAL_DELIVERY");

      const delivery: Prisma.InputJsonObject = { ...MANUAL_DELIVERY_PAYLOAD };
      if (order.fulfillment) {
        const fulfillmentClaim = await tx.fulfillment.updateMany({
          where: {
            id: order.fulfillment.id,
            status: order.fulfillment.status,
            delivery: { equals: Prisma.DbNull },
          },
          data: { status: FulfillmentStatus.FULFILLED, delivery },
        });
        if (fulfillmentClaim.count !== 1)
          throw new ManualDeliveryError("CONCURRENT_MANUAL_DELIVERY");
      } else {
        await tx.fulfillment.create({
          data: {
            orderId,
            provider: "manual",
            status: FulfillmentStatus.FULFILLED,
            delivery,
          },
        });
      }

      await tx.orderEvent.createMany({
        data: [
          { orderId, status: OrderStatus.DELIVERED, note: MANUAL_DELIVERY_CUSTOMER_NOTE },
          { orderId, status: OrderStatus.DELIVERED, note: manualDeliveryInternalNote(reason) },
        ],
      });
      await audit(adminId, "ORDER_MANUAL_DELIVERY", "Order", orderId, { orderId, reason }, tx);
      return { status: "DELIVERED" as const };
    });
  } catch (error) {
    // Fulfillment criado em paralelo (unique orderId) ou conflito de escrita:
    // outra operação mexeu no pedido ao mesmo tempo — nada foi gravado.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    )
      throw new ManualDeliveryError("CONCURRENT_MANUAL_DELIVERY");
    throw error;
  }
}
