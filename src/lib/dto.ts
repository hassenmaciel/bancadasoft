import type {
  Category,
  Brand,
  Fulfillment,
  Order,
  OrderItem,
  Payment,
  Product,
  User,
} from "@prisma/client";
import type { DynamicField } from "./providers/automation";

export type CategoryDTO = Pick<Category, "id" | "slug" | "name">;
export type BrandDTO = Pick<Brand, "id" | "slug" | "name">;

export type ProductDTO = Pick<
  Product,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "longDescription"
  | "type"
  | "deliveryType"
  | "deliveryEstimate"
  | "duration"
  | "imageUrl"
  | "priceCents"
  | "status"
  | "available"
> & { category: CategoryDTO | null; brand: BrandDTO | null; checkoutFields: DynamicField[] };

export type OrderItemDTO = { id: string; product: ProductDTO; unitPriceCents: number };
export type PaymentDTO = Pick<Payment, "status" | "amountCents"> & {
  externalPaymentId: string | null;
  pixPayload: string;
  qrCodeImage: string | null;
  expirationDate: Date;
};
export type DeliveryDTO = {
  deliveryType?: "CREDENTIALS" | "LICENSE" | "CODE" | "TEXT" | "MULTI_FIELD";
  deliveryFields?: Array<{ key: string; label: string; value: string; sensitive: boolean }>;
  title?: string;
  username?: string;
  password?: string;
  credential?: string;
  instructions?: string;
};
export type FulfillmentDTO = Pick<Fulfillment, "status"> & { delivery?: DeliveryDTO };
export type OrderDTO = Pick<Order, "id" | "publicToken" | "status" | "totalCents" | "createdAt"> & {
  items: OrderItemDTO[];
  payment: PaymentDTO | null;
  fulfillment: FulfillmentDTO | null;
  events: Array<{ status: string; note: string; createdAt: Date }>;
};
export type UserSessionDTO = Pick<User, "id" | "email" | "name" | "role">;

type ProductWithCategory = Product & { category?: Category | null; brand?: Brand | null; providerProducts?: Array<{ active: boolean; mode: string; technicalEligibility?: string; fieldSchema?: unknown; provider?: { active: boolean; code: string } }> };

const publicCheckoutFields = (product: ProductWithCategory): DynamicField[] => {
  const link = product.providerProducts?.find((candidate) => candidate.active && candidate.mode === "REAL" && candidate.provider?.active && candidate.provider.code === "heartunlocks" && candidate.technicalEligibility === "READY");
  if (!Array.isArray(link?.fieldSchema)) return [];
  return (link.fieldSchema as DynamicField[]).filter((field) => field.customerVisible && field.key !== "quantity").map((field) => ({ ...field, sensitive: false }));
};

export const normalizeQrCodeImage = (encodedImage: string | null | undefined) => {
  if (!encodedImage) return null;
  return encodedImage.startsWith("data:image/") ? encodedImage : `data:image/png;base64,${encodedImage}`;
};

export const productDto = (product: ProductWithCategory): ProductDTO => ({
  id: product.id,
  slug: product.slug,
  name: product.name,
  description: product.description,
  longDescription: product.longDescription,
  type: product.type,
  deliveryType: product.deliveryType,
  deliveryEstimate: product.deliveryEstimate,
  duration: product.duration,
  imageUrl: product.imageUrl,
  priceCents: product.priceCents,
  status: product.status,
  available: product.available,
  category: product.category
    ? { id: product.category.id, slug: product.category.slug, name: product.category.name }
    : null,
  brand: product.brand ? { id: product.brand.id, slug: product.brand.slug, name: product.brand.name } : null,
  checkoutFields: publicCheckoutFields(product),
});

export const orderDto = (order: any, options: { includeDelivery?: boolean } = {}): OrderDTO => ({
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
        delivery: options.includeDelivery === false ? undefined : (order.fulfillment.delivery as DeliveryDTO | null) ?? undefined,
      }
    : null,
  events: order.events,
});
