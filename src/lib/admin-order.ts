import type { Prisma } from "@prisma/client";

export const adminOrderInclude = {
  customer: { select: { id: true, name: true, email: true } },
  items: { include: { product: { select: { id: true, name: true, slug: true } } } },
  payment: { include: { events: { orderBy: { createdAt: "asc" as const } } } },
  fulfillment: { include: { providerOrders: { include: { provider: true, providerProduct: true }, orderBy: { createdAt: "asc" as const } } } },
  events: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.OrderInclude;

export type AdminOrderRecord = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>;

export type AdminOrderDTO = {
  id: string;
  publicToken: string;
  status: string;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; email: string };
  items: Array<{ id: string; unitPriceCents: number; product: { id: string; name: string; slug: string } }>;
  payment: null | {
    id: string; status: string; provider: string; providerReference: string; pixCode: string;
    expiresAt: string; createdAt: string;
    events: Array<{ id: string; providerEventId: string; createdAt: string }>;
  };
  fulfillment: null | { id: string; status: string; provider: string; delivery: unknown; createdAt: string; updatedAt: string; providerOrders:Array<{id:string;providerName:string;providerProductId:string|null;externalProductId:string|null;externalOrderId:string|null;status:string;costCents:number|null;currency:string;attempts:number;lastError:string|null;createdAt:string;updatedAt:string}> };
  events: Array<{ id: string; status: string; note: string; createdAt: string }>;
};

export const adminOrderDto = (order: AdminOrderRecord): AdminOrderDTO => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  totalCents: order.totalCents,
  createdAt: order.createdAt.toISOString(),
  updatedAt: order.updatedAt.toISOString(),
  customer: order.customer,
  items: order.items.map((item) => ({ id: item.id, unitPriceCents: item.unitPriceCents, product: item.product })),
  payment: order.payment ? {
    id: order.payment.id,
    status: order.payment.status,
    provider: order.payment.provider,
    providerReference: order.payment.providerReference,
    pixCode: order.payment.pixCode,
    expiresAt: order.payment.expiresAt.toISOString(),
    createdAt: order.payment.createdAt.toISOString(),
    events: order.payment.events.map((event) => ({ id: event.id, providerEventId: event.providerEventId, createdAt: event.createdAt.toISOString() })),
  } : null,
  fulfillment: order.fulfillment ? {
    id: order.fulfillment.id,
    status: order.fulfillment.status,
    provider: order.fulfillment.provider,
    delivery: order.fulfillment.delivery,
    createdAt: order.fulfillment.createdAt.toISOString(),
    updatedAt: order.fulfillment.updatedAt.toISOString(),
    providerOrders: order.fulfillment.providerOrders.map((providerOrder) => ({ id:providerOrder.id, providerName:providerOrder.provider.name, providerProductId:providerOrder.providerProductId, externalProductId:providerOrder.providerProduct?.externalProductId ?? null, externalOrderId:providerOrder.externalOrderId, status:providerOrder.status, costCents:providerOrder.costCents, currency:providerOrder.currency, attempts:providerOrder.attempts, lastError:providerOrder.lastError, createdAt:providerOrder.createdAt.toISOString(), updatedAt:providerOrder.updatedAt.toISOString() })),
  } : null,
  events: order.events.map((event) => ({ id: event.id, status: event.status, note: event.note, createdAt: event.createdAt.toISOString() })),
});
