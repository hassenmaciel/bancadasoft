import { createHash } from "node:crypto";
import {
  FulfillmentStatus,
  OrderStatus,
  Prisma,
  ProviderOrderStatus,
} from "@prisma/client";
import { prisma } from "../prisma";
import { normalizeProviderReplay, parseProviderDelivery } from "./delivery";
import {
  acceptsLicenseSuccessWithoutText,
  LICENSE_SUCCESS_MANUAL_REVIEW_NOTE,
  licenseConfirmationDelivery,
} from "../unlocktool-license";

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

export function normalizeCredentialReplay(text: string) {
  return normalizeProviderReplay(text);
}

export function parseCredentials(text: string | null) {
  if (!text) return null;
  const normalized = normalizeCredentialReplay(text);
  const username = normalized
    .match(/^\s*(?:USERNAME|USER|LOGIN)\s*(?:=>|:)\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  const password = normalized
    .match(/^\s*(?:PASSWORD|PASS)\s*(?:=>|:)\s*(.+?)\s*$/im)?.[1]
    ?.trim();
  return username && password ? { username, password } : null;
}

export function credentialDelivery(
  credentials: { username: string; password: string },
  product: { name: string },
) {
  return {
    kind: "credentials",
    title: product.name,
    username: credentials.username,
    password: credentials.password,
    deliveryType: "CREDENTIALS" as const,
    deliveryFields: [
      { key: "username", label: "Usuário/Login", value: credentials.username, sensitive: false },
      { key: "password", label: "Senha", value: credentials.password, sensitive: true },
    ],
    instructions: "Use as credenciais somente durante o período contratado.",
  };
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

type CallbackTx = Prisma.TransactionClient;
type CallbackCurrent = {
  id: string;
  orderId: string;
  fulfillmentId: string;
};

// Conclusão comum (com retorno textual ou, só para a licença UnlockTool, sem ele):
// mesma escrita e mesmos eventos de sempre; manualReviewNote acrescenta um evento.
async function completeDelivered(
  tx: CallbackTx,
  current: CallbackCurrent,
  input: HeartUnlocksCallback,
  eventKey: string,
  delivery: Prisma.InputJsonValue,
  manualReviewNote?: string,
) {
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
          ...(manualReviewNote
            ? [{ status: OrderStatus.DELIVERED, note: manualReviewNote }]
            : []),
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
  const replay = decodeReplay(input.replay);

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
            include: {
              fulfillment: true,
              order: {
                select: {
                  items: {
                    take: 1,
                    select: {
                      product: {
                        select: {
                          name: true,
                          type: true,
                          brand: { select: { name: true } },
                        },
                      },
                    },
                  },
                },
              },
              providerProduct: { select: { expectedDeliveryType: true } },
            },
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
          const callbackProduct = current.order.items[0]?.product;
          // Só a licença UnlockTool aceita "success" sem retorno textual utilizável.
          const licenseWithoutText = acceptsLicenseSuccessWithoutText(
            callbackProduct,
            current.providerProduct?.expectedDeliveryType,
          );
          if (normalized === "success" && replay) {
            const product = callbackProduct;
            if (!product) throw new Error("PROVIDER_PRODUCT_UNAVAILABLE");
            const delivery = parseProviderDelivery(replay, product, current.providerProduct?.expectedDeliveryType);
            if (!delivery && !licenseWithoutText) throw new Error("REPLAY_REQUIRES_ACTION");
            if (delivery)
              return completeDelivered(tx, current, input, eventKey, delivery);
          }
          if (normalized === "success" && licenseWithoutText && callbackProduct)
            return completeDelivered(
              tx,
              current,
              input,
              eventKey,
              licenseConfirmationDelivery(callbackProduct),
              LICENSE_SUCCESS_MANUAL_REVIEW_NOTE,
            );
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
