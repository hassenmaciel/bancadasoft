import type {
  Category,
  Fulfillment,
  Order,
  OrderItem,
  Payment,
  Product,
  User,
} from "@prisma/client";

export type CategoryDTO = Pick<Category, "id" | "slug" | "name">;

export type ProductDTO = Pick<
  Product,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "type"
  | "duration"
  | "imageUrl"
  | "priceCents"
  | "status"
  | "available"
> & { category: CategoryDTO | null };

export type OrderItemDTO = { id: string; product: ProductDTO; unitPriceCents: number };
export type PaymentDTO = Pick<Payment, "status" | "provider" | "amountCents"> & {
  externalPaymentId: string | null;
  pixPayload: string;
  qrCodeImage: string | null;
  expirationDate: Date;
};
export type DeliveryDTO = { credential?: string; instructions?: string };
export type FulfillmentDTO = Pick<Fulfillment, "status" | "provider"> & { delivery?: DeliveryDTO };
export type OrderDTO = Pick<Order, "id" | "publicToken" | "status" | "totalCents" | "createdAt"> & {
  items: OrderItemDTO[];
  payment: PaymentDTO | null;
  fulfillment: FulfillmentDTO | null;
  events: Array<{ status: string; note: string; createdAt: Date }>;
};
export type UserSessionDTO = Pick<User, "id" | "email" | "name" | "role">;

type ProductWithCategory = Product & { category?: Category | null };

export const normalizeQrCodeImage = (encodedImage: string | null | undefined) => {
  if (!encodedImage) return null;
  return encodedImage.startsWith("data:image/") ? encodedImage : `data:image/png;base64,${encodedImage}`;
};

export const productDto = (product: ProductWithCategory): ProductDTO => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  description: product.description,
  type: product.type,
  duration: product.duration,
  imageUrl: product.imageUrl,
  priceCents: product.priceCents,
  status: product.status,
  available: product.available,
  category: product.category
    ? { id: product.category.id, slug: product.category.slug, name: product.category.name }
    : null,
});

export const orderDto = (order: any): OrderDTO => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  totalCents: order.totalCents,
  createdAt: order.createdAt,
  items: order.items.map((item: OrderItem & { product: ProductWithCategory }) => ({
    id: item.id,
    product: productDto(item.product),
    unitPriceCents: item.unitPriceCents,
  })),
  payment: order.payment
    ? {
        status: order.payment.status,
        provider: order.payment.provider,
        amountCents: order.payment.amountCents,
        externalPaymentId: order.payment.externalPaymentId,
        pixPayload: order.payment.pixCode,
        qrCodeImage: normalizeQrCodeImage(order.payment.qrCode),
        expirationDate: order.payment.expiresAt,
      }
    : null,
  fulfillment: order.fulfillment
    ? {
        status: order.fulfillment.status,
        provider: order.fulfillment.provider,
        delivery: (order.fulfillment.delivery as DeliveryDTO | null) ?? undefined,
      }
    : null,
  events: order.events,
});
