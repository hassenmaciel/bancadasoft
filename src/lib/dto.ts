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
import { publicVariantFields } from "./product-variants";
import { isProductionProviderCode } from "./providers/selection";
import { resolveTierPrice, resolveVisiblePrice, type PriceViewer } from "./commercial-pricing";

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
  | "downloadUrl"
  | "downloadLabel"
  | "status"
  | "available"
> & {
  priceCents: number | null;
  priceVisible: boolean;
  priceTier: "NORMAL" | "PREMIUM" | null;
  category: CategoryDTO | null;
  brand: BrandDTO | null;
  checkoutFields: DynamicField[];
  variants: ProductVariantDTO[];
};

export type ProductVariantDTO = {
  id: string;
  name: string;
  priceCents: number | null;
  checkoutFields: DynamicField[];
};

export type OrderItemDTO = {
  id: string;
  product: ProductDTO;
  variant: Pick<ProductVariantDTO, "id" | "name"> | null;
  unitPriceCents: number;
};
export type PaymentDTO = Pick<Payment, "status" | "amountCents"> & {
  externalPaymentId: string | null;
  pixPayload: string;
  qrCodeImage: string | null;
  expirationDate: Date;
  /** Horário do servidor ao montar a resposta — referência do contador regressivo. */
  serverTime: string;
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
export type UserSessionDTO = Pick<User, "id" | "email" | "name" | "role" | "customerTier">;

type ProductWithCategory = Product & {
  category?: Category | null;
  brand?: Brand | null;
  providerProducts?: Array<{ active: boolean; mode: string; technicalEligibility?: string; fieldSchema?: unknown; provider?: { active: boolean; code: string } }>;
  variants?: Array<{
    id: string;
    name: string;
    active: boolean;
    sortOrder: number;
    priceCents: number | null;
    normalPriceCents?: number | null;
    premiumPriceCents?: number | null;
    publicationBlocked: boolean;
    providerProduct: {
      active: boolean;
      mode: string;
      technicalEligibility?: string;
      fieldSchema?: unknown;
      provider: { active: boolean; code: string };
      providerCostCents?: number | null;
      contractSignature?: string | null;
    };
  }>;
};

const publicCheckoutFields = (product: ProductWithCategory): DynamicField[] => {
  const link = product.providerProducts?.find((candidate) => candidate.active && candidate.mode === "REAL" && candidate.provider?.active && candidate.provider.code === "heartunlocks" && candidate.technicalEligibility === "READY");
  if (!Array.isArray(link?.fieldSchema)) return [];
  return (link.fieldSchema as DynamicField[]).filter((field) => field.customerVisible && field.key !== "quantity").map((field) => ({ ...field, sensitive: false }));
};

export const normalizeQrCodeImage = (encodedImage: string | null | undefined) => {
  if (!encodedImage) return null;
  return encodedImage.startsWith("data:image/") ? encodedImage : `data:image/png;base64,${encodedImage}`;
};

export const productDto = (product: ProductWithCategory, viewer: PriceViewer = null): ProductDTO => {
  const productPrice = resolveVisiblePrice(product, viewer);
  const variants = (product.variants ?? [])
    .filter((variant) =>
      variant.active &&
      !variant.publicationBlocked &&
      Boolean(resolveTierPrice(variant, viewer)) &&
      variant.providerProduct.active &&
      variant.providerProduct.mode === "REAL" &&
      variant.providerProduct.provider.active &&
      isProductionProviderCode(variant.providerProduct.provider.code) &&
      variant.providerProduct.technicalEligibility === "READY",
    )
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((variant) => ({
      id: variant.id,
      name: variant.name,
      priceCents: productPrice.visible ? resolveTierPrice(variant, viewer) : null,
      checkoutFields: publicVariantFields(variant.providerProduct.fieldSchema),
    }));
  const variantPrices = variants.map((variant) => variant.priceCents).filter((price): price is number => price !== null);
  return {
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
  downloadUrl: product.downloadUrl,
  downloadLabel: product.downloadLabel,
  priceCents: productPrice.visible ? (variantPrices.length ? Math.min(...variantPrices) : productPrice.priceCents) : null,
  priceVisible: productPrice.visible,
  priceTier: productPrice.tier,
  status: product.status,
  available: product.available,
  category: product.category
    ? { id: product.category.id, slug: product.category.slug, name: product.category.name }
    : null,
  brand: product.brand ? { id: product.brand.id, slug: product.brand.slug, name: product.brand.name } : null,
  checkoutFields: publicCheckoutFields(product),
  variants,
  };
};

const INTERNAL_EVENT_MARKERS = ["revisao manual", "analise administrativa"];
const foldText = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Eventos internos (revisão manual / análise administrativa) não chegam ao cliente;
// o Admin continua lendo os eventos completos por admin-order.ts.
export const customerVisibleEvents = (
  events: Array<{ status: string; note: string; createdAt: Date }>,
): OrderDTO["events"] =>
  events
    .filter((event) => {
      const note = foldText(event.note ?? "");
      return !INTERNAL_EVENT_MARKERS.some((marker) => note.includes(marker));
    })
    .map(({ status, note, createdAt }) => ({ status, note, createdAt }));

export const orderDto = (order: any, options: { includeDelivery?: boolean } = {}): OrderDTO => ({
  id: order.id,
  publicToken: order.publicToken,
  status: order.status,
  totalCents: order.totalCents,
  createdAt: order.createdAt,
  items: order.items.map((item: OrderItem & { product: ProductWithCategory; productVariant?: { id: string; name: string } | null }) => ({
    id: item.id,
    product: productDto(item.product),
    variant: item.productVariant ? { id: item.productVariant.id, name: item.productVariant.name } : null,
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
        serverTime: new Date().toISOString(),
      }
    : null,
  fulfillment: order.fulfillment
    ? {
        status: order.fulfillment.status,
        delivery: options.includeDelivery === false ? undefined : (order.fulfillment.delivery as DeliveryDTO | null) ?? undefined,
      }
    : null,
  events: customerVisibleEvents(order.events ?? []),
});
