import { DeliveryType, PriceVisibility, PricingMode, ProductStatus, ProductType, type Brand, type Category, type Product } from "@prisma/client";
import { z } from "zod";
import { isProductionProviderCode } from "./providers/selection";
import type { PricingResult } from "./pricing";

const optionalUrl = z.union([z.string().url("Informe uma URL válida."), z.literal("")]).transform((value) => value || null);

const optionalHttpUrl = z
  .union([
    z
      .string()
      .trim()
      .refine((value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      }, "Informe uma URL http:// ou https:// válida."),
    z.literal(""),
  ])
  .transform((value) => value || null);

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(120),
  slug: z.string().trim().min(1, "Slug é obrigatório.").max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens."),
  description: z.string().trim().min(1, "Descrição é obrigatória.").max(500),
  longDescription: z.string().trim().max(5000).nullable().optional(),
  type: z.nativeEnum(ProductType),
  deliveryType: z.nativeEnum(DeliveryType).default(DeliveryType.AUTOMATIC),
  deliveryEstimate: z.string().trim().max(100).nullable().optional(),
  searchTerms: z.string().trim().max(500).default(""),
  duration: z.string().trim().max(80).nullable().optional(),
  priceCents: z.number().int().min(0, "O preço não pode ser negativo."),
  priceVisibility: z.nativeEnum(PriceVisibility).default(PriceVisibility.PUBLIC),
  normalPriceCents: z.number().int().min(1).nullable().optional(),
  premiumPriceCents: z.number().int().min(1).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  pricingMode: z.nativeEnum(PricingMode).default(PricingMode.MANUAL),
  manualPriceCents: z.number().int().min(1).nullable().optional(),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  categoryId: z.string().trim().min(1, "Categoria é obrigatória."),
  brandId: z.string().trim().nullable().optional(),
  imageUrl: optionalUrl.nullable().optional(),
  downloadUrl: optionalHttpUrl.nullable().optional(),
  downloadLabel: z.string().trim().max(60).nullable().optional().transform((value) => value || null),
  status: z.nativeEnum(ProductStatus),
  available: z.boolean().default(true),
}).transform((value) => ({
  ...value,
  manualPriceCents: value.pricingMode === PricingMode.MANUAL ? value.manualPriceCents ?? value.priceCents : null,
})).superRefine((value, context) => {
  if (value.pricingMode === PricingMode.MANUAL && !value.manualPriceCents) {
    context.addIssue({ code: "custom", path: ["manualPriceCents"], message: "Informe o preço manual." });
  }
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(80),
  slug: z.string().trim().min(1, "Slug é obrigatório.").max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens."),
  active: z.boolean().default(true),
});

export const productVariantInputSchema = z.object({
  providerProductId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  pricingMode: z.nativeEnum(PricingMode).default(PricingMode.AUTO_GLOBAL),
  manualPriceCents: z.number().int().min(1).nullable().optional(),
  normalPriceCents: z.number().int().min(1).nullable().optional(),
  premiumPriceCents: z.number().int().min(1).nullable().optional(),
}).superRefine((value, context) => {
  if (value.pricingMode === PricingMode.MANUAL && !value.manualPriceCents)
    context.addIssue({ code: "custom", path: ["manualPriceCents"], message: "Informe o preço manual da variante." });
});

export type AdminVariantDTO = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  sortOrder: number;
  priceCents: number | null;
  pricingMode: string;
  manualPriceCents: number | null;
  normalPriceCents: number | null;
  premiumPriceCents: number | null;
  suggestedPriceCents: number | null;
  pricingStatus: string;
  publicationBlocked: boolean;
  holdReason: string | null;
  providerProduct: {
    id: string;
    externalProductId: string;
    label: string | null;
    providerCostCents: number | null;
    currency: string;
    active: boolean;
    provider: { id: string; name: string; active: boolean };
  };
};

export type AdminProductDTO = Pick<Product, "id" | "slug" | "name" | "description" | "longDescription" | "type" | "deliveryType" | "deliveryEstimate" | "searchTerms" | "duration" | "priceCents" | "priceVisibility" | "normalPriceCents" | "premiumPriceCents" | "costCents" | "pricingMode" | "manualPriceCents" | "suggestedPriceCents" | "pricingStatus" | "featured" | "sortOrder" | "status" | "available" | "imageUrl" | "downloadUrl" | "downloadLabel"> & {
  category: Pick<Category, "id" | "name" | "slug">;
  brand: Pick<Brand, "id" | "name" | "slug"> | null;
  updatedAt: string;
  pricingComputedAt: string | null;
  pricing: PricingResult | null;
  providerProducts: Array<{id:string;externalProductId:string;label:string|null;providerCostCents:number|null;currency:string;active:boolean;mode:string;metadata:unknown;lastSyncedAt:string|null;syncStatus:string|null;updatedAt:string;automationClass:string;technicalEligibility:string;homologationStatus:string;contractSignature:string|null;fieldSchema:unknown;expectedDeliveryType:string;provider:{id:string;name:string;code:string;active:boolean}}>;
  variants: AdminVariantDTO[];
};

type AdminProductSource=Product & {category:Category;brand:Brand|null;providerProducts?:Array<{id:string;externalProductId:string;label:string|null;providerCostCents:number|null;currency:string;active:boolean;mode:string;metadata:unknown;lastSyncedAt:Date|null;syncStatus:string|null;updatedAt:Date;automationClass:string;technicalEligibility:string;homologationStatus:string;contractSignature:string|null;fieldSchema:unknown;expectedDeliveryType:string;provider:{id:string;name:string;code:string;active:boolean}}>;
  variants?: Array<{id:string;name:string;code:string;active:boolean;sortOrder:number;priceCents:number|null;normalPriceCents:number|null;premiumPriceCents:number|null;pricingMode:string;manualPriceCents:number|null;suggestedPriceCents:number|null;pricingStatus:string;publicationBlocked:boolean;holdReason:string|null;providerProduct:{id:string;externalProductId:string;label:string|null;providerCostCents:number|null;currency:string;active:boolean;provider:{id:string;name:string;active:boolean}}}>;
};
export const operationalProviderProducts = <T extends {active:boolean;mode:string;provider:{active:boolean;code:string}}>(links:T[]) =>
  links.filter(link => link.active && link.mode === "REAL" && link.provider.active && isProductionProviderCode(link.provider.code));

export const adminProductDto = (product: AdminProductSource, pricing: PricingResult | null = null): AdminProductDTO => ({
  id: product.id, slug: product.slug, name: product.name, description: product.description,
  longDescription: product.longDescription, deliveryType: product.deliveryType,
  deliveryEstimate: product.deliveryEstimate, searchTerms: product.searchTerms,
  type: product.type, duration: product.duration, priceCents: product.priceCents,
  priceVisibility: product.priceVisibility, normalPriceCents: product.normalPriceCents, premiumPriceCents: product.premiumPriceCents,
  costCents: product.costCents, pricingMode: product.pricingMode, manualPriceCents: product.manualPriceCents,
  suggestedPriceCents: product.suggestedPriceCents, pricingStatus: product.pricingStatus,
  pricingComputedAt: product.pricingComputedAt?.toISOString() ?? null, pricing,
  featured: product.featured, sortOrder: product.sortOrder,
  status: product.status, available: product.available, imageUrl: product.imageUrl,
  downloadUrl: product.downloadUrl, downloadLabel: product.downloadLabel,
  category: { id: product.category.id, name: product.category.name, slug: product.category.slug },
  brand: product.brand ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug } : null,
  updatedAt: product.updatedAt.toISOString(),
  providerProducts:operationalProviderProducts(product.providerProducts??[]).map(link=>({...link,mode:String(link.mode),lastSyncedAt:link.lastSyncedAt?.toISOString()??null,updatedAt:link.updatedAt.toISOString()})),
  variants:(product.variants??[]).sort((a,b)=>a.sortOrder-b.sortOrder).map(variant=>({
    id:variant.id,name:variant.name,code:variant.code,active:variant.active,sortOrder:variant.sortOrder,
    priceCents:variant.priceCents,normalPriceCents:variant.normalPriceCents,premiumPriceCents:variant.premiumPriceCents,pricingMode:variant.pricingMode,manualPriceCents:variant.manualPriceCents,
    suggestedPriceCents:variant.suggestedPriceCents,pricingStatus:variant.pricingStatus,
    publicationBlocked:variant.publicationBlocked,holdReason:variant.holdReason,
    providerProduct:variant.providerProduct,
  })),
});

export const productStatuses = Object.values(ProductStatus);
export const productTypes = Object.values(ProductType);
export const deliveryTypes = Object.values(DeliveryType);
