import { createHash } from "node:crypto";
import {
  FulfillmentStatus,
  OrderStatus,
  Prisma,
  ProviderOrderStatus,
} from "@prisma/client";
import { prisma } from "../prisma";

export type HeartUnlocksCallback = {
  reference_id: string;
  order_id: string;
  status: string;
  replay?: string;
};

export function decodeReplay(value?: string) {
  if (
    !value ||
    !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.from(value, "base64"))
      .trim();
    return text && /^[\x09\x0A\x0D\x20-\x7EÀ-ÿ]+$/u.test(text) ? text : null;
  } catch {
    return null;
  }
}

export function parseCredentials(text: string | null) {
  if (!text) return null;
  const username = text
    .match(/^\s*(?:USERNAME|USER|LOGIN)\s*(?:=>|:)\s*(\S.+?)\s*$/im)?.[1]
    ?.trim();
  const password = text
    .match(/^\s*(?:PASSWORD|PASS)\s*(?:=>|:)\s*(\S.+?)\s*$/im)?.[1]
    ?.trim();
  return username && password ? { username, password } : null;
}

export function callbackEventKey(input: HeartUnlocksCallback) {
  return createHash("sha256")
    .update(
      [
        input.reference_id,
        input.order_id,
        input.status,
        input.replay ?? "",
      ].join("\0"),
    )
    .digest("hex");
}

const isPrismaCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

export async function processHeartUnlocksCallback(input: HeartUnlocksCallback) {
  const providerOrder = await prisma.providerOrder.findFirst({
    where: {
      OR: [
        { id: input.reference_id },
        { requestReference: input.reference_id },
      ],
    },
  });
  if (!providerOrder) return { matched: false, duplicate: false };
  const eventKey = callbackEventKey(input);
  const normalized = input.status.toLowerCase();
  const credentials = parseCredentials(decodeReplay(input.replay));

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.providerCallbackEvent.create({
            data: {
              providerOrderId: providerOrder.id,
              eventKey,
              status: normalized,
              payload: {
                reference_id: input.reference_id,
                order_id: input.order_id,
                status: input.status,
                replay: input.replay ?? null,
              } as Prisma.InputJsonValue,
            },
          });
          const current = await tx.providerOrder.findUniqueOrThrow({
            where: { id: providerOrder.id },
            include: { fulfillment: true },
          });
          if (
            current.status === ProviderOrderStatus.COMPLETED ||
            current.fulfillment.delivery
          ) {
            await tx.providerCallbackEvent.update({
              where: { eventKey },
              data: { processedAt: new Date() },
            });
            return { matched: true, duplicate: false, final: true };
          }
          if (normalized === "rejected" || normalized === "failed") {
            await tx.providerOrder.update({
              where: { id: current.id },
              data: {
                status: ProviderOrderStatus.FAILED,
                externalOrderId: input.order_id,
                lastError: "PROVIDER_REJECTED",
              },
            });
            await tx.fulfillment.update({
              where: { id: current.fulfillmentId },
              data: { status: FulfillmentStatus.FAILED },
            });
            await tx.order.update({
              where: { id: current.orderId },
              data: {
                status: OrderStatus.FAILED,
                events: {
                  create: {
                    status: OrderStatus.FAILED,
                    note: "Fornecedor rejeitou o processamento.",
                  },
                },
              },
            });
            await tx.providerCallbackEvent.update({
              where: { eventKey },
              data: { processedAt: new Date() },
            });
            return { matched: true, duplicate: false, delivered: false };
          }
          if (normalized === "success" && credentials) {
            const delivery = {
              kind: "credentials",
              title: "UnlockTool — Aluguel 6 horas",
              username: credentials.username,
              password: credentials.password,
              instructions:
                "Use as credenciais somente durante o período contratado.",
            };
            await tx.providerOrder.update({
              where: { id: current.id },
              data: {
                status: ProviderOrderStatus.COMPLETED,
                externalOrderId: input.order_id,
                lastError: null,
              },
            });
            await tx.fulfillment.update({
              where: { id: current.fulfillmentId },
              data: { status: FulfillmentStatus.FULFILLED, delivery },
            });
            await tx.order.update({
              where: { id: current.orderId },
              data: {
                status: OrderStatus.DELIVERED,
                events: {
                  create: [
                    {
                      status: OrderStatus.FULFILLED,
                      note: "Liberação concluída pelo fornecedor.",
                    },
                    {
                      status: OrderStatus.DELIVERED,
                      note: "Entrega disponibilizada ao cliente.",
                    },
                  ],
                },
              },
            });
            await tx.providerCallbackEvent.update({
              where: { eventKey },
              data: { processedAt: new Date() },
            });
            return {
              matched: true,
              duplicate: false,
              delivered: true,
              orderId: current.orderId,
            };
          }
          if (normalized === "success") {
            await tx.providerOrder.update({
              where: { id: current.id },
              data: {
                status: ProviderOrderStatus.FAILED,
                externalOrderId: input.order_id,
                lastError: "REPLAY_REQUIRES_ACTION",
              },
            });
            await tx.fulfillment.update({
              where: { id: current.fulfillmentId },
              data: { status: FulfillmentStatus.FAILED },
            });
            await tx.order.update({
              where: { id: current.orderId },
              data: {
                status: OrderStatus.FAILED,
                events: {
                  create: {
                    status: OrderStatus.FAILED,
                    note: "Entrega recebida requer análise administrativa.",
                  },
                },
              },
            });
          }
          await tx.providerCallbackEvent.update({
            where: { eventKey },
            data: { processedAt: new Date() },
          });
          return { matched: true, duplicate: false, delivered: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isPrismaCode(error, "P2002"))
        return { matched: true, duplicate: true };
      if (isPrismaCode(error, "P2034") && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("CALLBACK_SERIALIZATION_FAILED");
}
