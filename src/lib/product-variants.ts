import type { DynamicField } from "./providers/automation";
import {
  resolveProviderProduct,
  type ProviderModeValue,
  type ProviderProductCandidate,
} from "./providers/selection";

export type VariantProviderProduct = ProviderProductCandidate & {
  fieldSchema?: unknown;
  technicalEligibility?: "READY" | "REVIEW" | "UNSUPPORTED";
};

export type CheckoutVariantCandidate = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  sortOrder: number;
  priceCents: number | null;
  publicationBlocked: boolean;
  providerProduct: VariantProviderProduct;
};

export type VariantResolution =
  | {
      status: "SELECTED";
      variant: CheckoutVariantCandidate;
      providerProduct: VariantProviderProduct;
      priceCents: number;
    }
  | {
      status:
        | "VARIANT_REQUIRED"
        | "VARIANT_NOT_FOUND"
        | "VARIANT_INACTIVE"
        | "VARIANT_BLOCKED"
        | "VARIANT_PRICE_UNAVAILABLE"
        | "PROVIDER_UNAVAILABLE";
      variant: null;
      providerProduct: null;
      priceCents: null;
    };

export function resolveCheckoutVariant(
  variants: CheckoutVariantCandidate[],
  variantId: string | undefined,
  mode: ProviderModeValue,
): VariantResolution | null {
  if (!variants.length) return null;
  if (!variantId)
    return {
      status: "VARIANT_REQUIRED",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  const variant = variants.find((candidate) => candidate.id === variantId);
  if (!variant)
    return {
      status: "VARIANT_NOT_FOUND",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  if (!variant.active)
    return {
      status: "VARIANT_INACTIVE",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  if (variant.publicationBlocked)
    return {
      status: "VARIANT_BLOCKED",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  if (!variant.priceCents || variant.priceCents < 1)
    return {
      status: "VARIANT_PRICE_UNAVAILABLE",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  const provider = resolveProviderProduct([variant.providerProduct], mode);
  if (provider.status !== "SELECTED")
    return {
      status: "PROVIDER_UNAVAILABLE",
      variant: null,
      providerProduct: null,
      priceCents: null,
    };
  return {
    status: "SELECTED",
    variant,
    providerProduct: provider.providerProduct,
    priceCents: variant.priceCents,
  };
}

export const publicVariantFields = (fieldSchema: unknown): DynamicField[] =>
  Array.isArray(fieldSchema)
    ? (fieldSchema as DynamicField[])
        .filter((field) => field.customerVisible && field.key !== "quantity")
        .map((field) => ({ ...field, sensitive: false }))
    : [];

export const canPublishVariantProduct = (
  variants: Array<{
    active: boolean;
    publicationBlocked: boolean;
    priceCents: number | null;
  }>,
) =>
  variants.length === 0 ||
  variants.some(
    (variant) =>
      variant.active &&
      !variant.publicationBlocked &&
      variant.priceCents !== null &&
      variant.priceCents > 0,
  );

export function resolvePurchasedProviderProduct<T extends ProviderProductCandidate>(
  persisted: T | null | undefined,
  legacyCandidates: T[],
  mode: ProviderModeValue,
) {
  return resolveProviderProduct(persisted ? [persisted] : legacyCandidates, mode);
}
