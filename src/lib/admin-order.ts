import type { Prisma } from "@prisma/client";
import { maskCpf } from "./masking";

export const adminOrderInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      cpfCnpj: true,
      whatsapp: true,
      passwordHash: true,
    },
  },
  items: {
    include: {
      product: { select: { id: true, name: true, slug: true } },
      productVariant: { select: { name: true } },
    },
  },
  payment: { include: { events: { orderBy: { createdAt: "asc" as const } } } },
  fulfillment: {
    include: {
      providerOrders: {
        include: {
          provider: true,
          providerProduct: true,
          callbackEvents: {
            select: {
              id: true,
              status: true,
              payload: true,
              processedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "asc" as const },
          },
        },
        orderBy: { createdAt: "asc" as const },
      },
    },
  },
  events: { orderBy: { createdAt: "asc" as const } },
  deliveryNotifications: {
    select: {
      id: true,
      channel: true,
      status: true,
      recipientMasked: true,
      attempts: true,
      lastAttemptAt: true,
      sentAt: true,
      errorMessage: true,
    },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.OrderInclude;

export type AdminOrderRecord = Prisma.OrderGetPayload<{
  include: typeof adminOrderInclude;
}>;
export type AdminCallbackDTO = {
  id: string;
  status: string;
  referenceId: string | null;
  providerOrderId: string | null;
  processedAt: string | null;
  createdAt: string;
};
export type AdminOrderDTO = {
  id: string;
  publicToken: string;
  status: string;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    email: string;
    cpfCnpj: string | null;
    whatsapp: string | null;
    guest: boolean;
  };
  items: Array<{
    id: string;
    unitPriceCents: number;
    product: { id: string; name: string; slug: string };
    variant: string | null;
  }>;
  payment: null | {
    id: string;
    status: string;
    provider: string;
    providerReference: string;
    pixCode: string;
    expiresAt: string;
    createdAt: string;
    events: Array<{ id: string; providerEventId: string; createdAt: string }>;
  };
  fulfillment: null | {
    id: string;
    status: string;
    provider: string;
    delivery: unknown;
    createdAt: string;
    updatedAt: string;
    providerOrders: Array<{
      id: string;
      providerName: string;
      providerProductId: string | null;
      externalProductId: string | null;
      externalOrderId: string | null;
      requestReference: string | null;
      status: string;
      costCents: number | null;
      currency: string;
      attempts: number;
      lastError: string | null;
      createdAt: string;
      updatedAt: string;
      callbackEvents: AdminCallbackDTO[];
    }>;
  };
  events: Array<{
    id: string;
    status: string;
    note: string;
    createdAt: string;
  }>;
  deliveryNotifications: Array<{
    id: string;
    channel: string;
    status: string;
    recipientMasked: string;
    attempts: number;
    lastAttemptAt: string | null;
    sentAt: string | null;
    errorMessage: string | null;
  }>;
};

export function sanitizeProviderError(value: string | null) {
  if (!value) return null;
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(token|secret|password)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}
const safeString = (value: unknown) =>
  typeof value === "string" ? value : null;
export function adminCallbackDto(event: {
  id: string;
  status: string;
  payload: unknown;
  processedAt: Date | null;
  createdAt: Date;
}): AdminCallbackDTO {
  const payload =
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  return {
    id: event.id,
    status: event.status,
    referenceId: safeString(payload.reference_id),
    providerOrderId: safeString(payload.order_id),
    processedAt: event.processedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export const adminOrderDto = (order: AdminOrderRecord): AdminOrderDTO => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
  customer: {
    id: order.customer.id,
    name: order.customer.name,
    email: order.customer.email,
    cpfCnpj: order.customer.cpfCnpj,
    whatsapp: order.customer.whatsapp,
    guest: order.customer.passwordHash === "PENDING_INVITE",
  },
  items: order.items.map((item) => ({
    id: item.id,
    unitPriceCents: item.unitPriceCents,
    product: item.product,
    variant: item.productVariant?.name ?? null,
  })),
  payment: order.payment
    ? {
        id: order.payment.id,
        status: order.payment.status,
        provider: order.payment.provider,
        providerReference: order.payment.providerReference,
        pixCode: order.payment.pixCode,
        expiresAt: order.payment.expiresAt.toISOString(),
        createdAt: order.payment.createdAt.toISOString(),
        events: order.payment.events.map((event) => ({
          id: event.id,
          providerEventId: event.providerEventId,
          createdAt: event.createdAt.toISOString(),
        })),
      }
    : null,
  fulfillment: order.fulfillment
    ? {
        id: order.fulfillment.id,
        status: order.fulfillment.status,
        provider: order.fulfillment.provider,
        delivery: order.fulfillment.delivery,
        createdAt: order.fulfillment.createdAt.toISOString(),
        updatedAt: order.fulfillment.updatedAt.toISOString(),
        providerOrders: order.fulfillment.providerOrders.map(
          (providerOrder) => ({
            id: providerOrder.id,
            providerName: providerOrder.provider.name,
            providerProductId: providerOrder.providerProductId,
            externalProductId:
              providerOrder.providerProduct?.externalProductId ?? null,
            externalOrderId: providerOrder.externalOrderId,
            requestReference: providerOrder.requestReference,
            status: providerOrder.status,
            costCents: providerOrder.costCents,
            currency: providerOrder.currency,
            attempts: providerOrder.attempts,
            lastError: sanitizeProviderError(providerOrder.lastError),
            createdAt: providerOrder.createdAt.toISOString(),
            updatedAt: providerOrder.updatedAt.toISOString(),
            callbackEvents: providerOrder.callbackEvents.map(adminCallbackDto),
          }),
        ),
      }
    : null,
  events: order.events.map((event) => ({
    id: event.id,
    status: event.status,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
  })),
  deliveryNotifications: (order.deliveryNotifications??[]).map((item) => ({
    ...item,
    lastAttemptAt: item.lastAttemptAt?.toISOString() ?? null,
    sentAt: item.sentAt?.toISOString() ?? null,
  })),
});

// DTO seguro para a LISTAGEM (PARTE 8/16): nunca inclui CPF completo,
// pixCode, delivery ou qualquer segredo — só o suficiente para localizar e
// triar um pedido no Admin. O detalhe completo continua em adminOrderDto,
// que é lido inteiramente no servidor pela página (Server Component).
export const adminOrderListSelect = {
  id: true,
  publicToken: true,
  status: true,
  totalCents: true,
  createdAt: true,
  customer: {
    select: {
      name: true,
      email: true,
      whatsapp: true,
      cpfCnpj: true,
      passwordHash: true,
    },
  },
  items: {
    select: {
      product: { select: { name: true } },
      productVariant: { select: { name: true } },
    },
  },
  payment: { select: { status: true } },
  fulfillment: { select: { status: true } },
} satisfies Prisma.OrderSelect;

export type AdminOrderListRecord = Prisma.OrderGetPayload<{
  select: typeof adminOrderListSelect;
}>;

export type AdminOrderListDTO = {
  id: string;
  publicToken: string;
  status: string;
  totalCents: number;
  createdAt: string;
  customer: {
    name: string;
    email: string;
    whatsapp: string | null;
    cpfMasked: string | null;
    guest: boolean;
  };
  items: Array<{ productName: string; variant: string | null }>;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
};

export const adminOrderListDto = (
  order: AdminOrderListRecord,
): AdminOrderListDTO => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  customer: {
    name: order.customer.name,
    email: order.customer.email,
    whatsapp: order.customer.whatsapp,
    cpfMasked: maskCpf(order.customer.cpfCnpj),
    guest: order.customer.passwordHash === "PENDING_INVITE",
  },
  items: order.items.map((item) => ({
    productName: item.product.name,
    variant: item.productVariant?.name ?? null,
  })),
  paymentStatus: order.payment?.status ?? null,
  fulfillmentStatus: order.fulfillment?.status ?? null,
});
