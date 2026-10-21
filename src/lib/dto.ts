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
import {
  TOPUP_MIN_CENTS,
  isFreeAmountTopup,
  premiumPlusPixPrice,
  resolveTierPrice,
  resolveVisiblePrice,
  topupCreditCents,
  type PriceViewer,
} from "./commercial-pricing";
import { premiumPlusPayment, productAcceptsBalancePayment } from "./balance-payment";
import { quantityRange } from "./checkout-quantity";

export type CategoryDTO = Pick<Category, "id" | "slug" | "name">;
export type BrandDTO = Pick<Brand, "id" | "slug" | "name">;

// Só para PREMIUM_PLUS (exceto recarga): os dois preços possíveis, para a tela
// decidir pela quantidade escolhida (ver premiumPlusPayment).
export type PremiumPlusPricesDTO = { plusPriceCents: number | null; pixPriceCents: number | null };

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
  priceTier: "NORMAL" | "PREMIUM" | "PREMIUM_PLUS" | null;
  // PREMIUM_PLUS: forma de pagamento do preço exibido (saldo = preço Premium
  // Plus; pix = menor preço Premium/Técnico). Ausente para os demais.
  priceMode?: "balance" | "pix";
  premiumPlus?: PremiumPlusPricesDTO;
  category: CategoryDTO | null;
  brand: BrandDTO | null;
  checkoutFields: DynamicField[];
  variants: ProductVariantDTO[];
  // Intervalo de quantidade por pedido; 1/1 = sem seletor (ver checkout-quantity.ts).
  minQuantity: number;
  maxQuantity: number;
};

export type ProductVariantDTO = {
  id: string;
  name: string;
  priceCents: number | null;
  premiumPlus?: PremiumPlusPricesDTO;
  // Recarga "Outro valor": o cliente digita o valor (priceCents = mínimo).
  freeAmount?: true;
  checkoutFields: DynamicField[];
};

export type OrderItemDTO = {
  id: string;
  product: ProductDTO;
  variant: Pick<ProductVariantDTO, "id" | "name"> | null;
  unitPriceCents: number;
  quantity: number;
};
export type PaymentDTO = Pick<Payment, "status" | "amountCents"> & {
  externalPaymentId: string | null;
  pixPayload: string;
  qrCodeImage: string | null;
  expirationDate: Date;
  /** Horário do servidor ao montar a resposta — referência do contador regressivo. */
  serverTime: string;
  /** Forma de pagamento do pedido; ausente equivale a PIX. */
  method?: "pix" | "balance";
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
  providerProducts?: Array<{ active: boolean; mode: string; technicalEligibility?: string; fieldSchema?: unknown; metadata?: unknown; provider?: { active: boolean; code: string } }>;
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
      metadata?: unknown;
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

// Recarga de Saldo sem variantes: o pacote é o único ProviderProduct REAL
// ativo do produto (o mesmo que o checkout resolve no modo REAL).
const productTopupCreditCents = (product: ProductWithCategory) => {
  const links = (product.providerProducts ?? []).filter((link) =>
    link.active &&
    link.mode === "REAL" &&
    link.provider?.active &&
    isProductionProviderCode(link.provider.code) &&
    (link.technicalEligibility === undefined || link.technicalEligibility === "READY"),
  );
  return links.length === 1 ? topupCreditCents(links[0].metadata) : null;
};

export const productDto = (
  product: ProductWithCategory,
  viewer: PriceViewer = null,
  // Saldo do PREMIUM_PLUS: decide se o preço exibido é o Premium Plus (saldo
  // cobre a quantidade mínima) ou o de PIX. Ignorado para os demais tiers.
  balance: { enabled: boolean; balanceCents: number } | null = null,
): ProductDTO => {
  // BALANCE_TOPUP exibe sempre o valor creditado pelo pacote, igual ao que o
  // checkout cobra (assertCheckoutPrice); priceCents e tiers não entram.
  // A visibilidade segue só o LOGIN_REQUIRED (o preço vem das variantes).
  const topup = product.type === "BALANCE_TOPUP";
  const topupVisible = !(product.priceVisibility === "LOGIN_REQUIRED" && !viewer);
  const productPrice = topup
    ? { visible: topupVisible, priceCents: topupVisible ? productTopupCreditCents(product) : null, tier: topupVisible ? viewer?.customerTier ?? null : null }
    : resolveVisiblePrice(product, viewer);
  // PREMIUM_PLUS nunca vê o preço Premium Plus sem saldo que o cubra (R3/R4).
  const premiumPlus = viewer?.customerTier === "PREMIUM_PLUS" && productAcceptsBalancePayment(product.type);
  const minQuantity = quantityRange(product).min;
  const premiumPlusPrices = (source: Parameters<typeof resolveTierPrice>[0]) => ({
    plusPriceCents: resolveTierPrice(source, viewer),
    pixPriceCents: premiumPlusPixPrice(source),
  });
  const shownPremiumPlus = (source: Parameters<typeof resolveTierPrice>[0]) =>
    premiumPlusPayment(balance, premiumPlusPrices(source), minQuantity);
  const variantPrice = (variant: NonNullable<ProductWithCategory["variants"]>[number]) =>
    topup
      ? isFreeAmountTopup(variant.providerProduct.metadata)
        ? TOPUP_MIN_CENTS
        : topupCreditCents(variant.providerProduct.metadata)
      : premiumPlus
        ? shownPremiumPlus(variant).unitCents
        : resolveTierPrice(variant, viewer);
  const variants = (product.variants ?? [])
    .filter((variant) =>
      variant.active &&
      !variant.publicationBlocked &&
      Boolean(variantPrice(variant)) &&
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
      priceCents: productPrice.visible ? variantPrice(variant) : null,
      ...(premiumPlus && productPrice.visible ? { premiumPlus: premiumPlusPrices(variant) } : {}),
      ...(topup && isFreeAmountTopup(variant.providerProduct.metadata) ? { freeAmount: true as const } : {}),
      checkoutFields: publicVariantFields(variant.providerProduct.fieldSchema),
    }));
  const variantPrices = variants.map((variant) => variant.priceCents).filter((price): price is number => price !== null);
  const productShown = premiumPlus && !variants.length ? shownPremiumPlus(product) : null;
  const cheapestVariant = variantPrices.length
    ? variants.find((variant) => variant.priceCents === Math.min(...variantPrices))
    : undefined;
  const priceMode = !premiumPlus || !productPrice.visible
    ? undefined
    : productShown
      ? productShown.method
      : cheapestVariant?.premiumPlus
        ? premiumPlusPayment(balance, cheapestVariant.premiumPlus, minQuantity).method
        : undefined;
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
    priceCents: productPrice.visible
      ? (variantPrices.length ? Math.min(...variantPrices) : productShown ? productShown.unitCents : productPrice.priceCents)
      : null,
    priceVisible: productPrice.visible,
    priceTier: productPrice.tier,
    ...(priceMode ? { priceMode } : {}),
    ...(productShown && productPrice.visible ? { premiumPlus: premiumPlusPrices(product) } : {}),
    status: product.status,
    available: product.available,
    category: product.category
      ? { id: product.category.id, slug: product.category.slug, name: product.category.name }
      : null,
    brand: product.brand ? { id: product.brand.id, slug: product.brand.slug, name: product.brand.name } : null,
    checkoutFields: publicCheckoutFields(product),
    variants,
    minQuantity: quantityRange(product).min,
    maxQuantity: quantityRange(product).max,
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
    quantity: item.quantity ?? 1,
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
      method: order.payment.provider === "balance" ? "balance" as const : "pix" as const,
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