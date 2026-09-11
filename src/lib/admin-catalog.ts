import { DeliveryType, ProductStatus, ProductType, type Brand, type Category, type Product } from "@prisma/client";
import { z } from "zod";

const optionalUrl = z.union([z.string().url("Informe uma URL válida."), z.literal("")]).transform((value) => value || null);

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
  costCents: z.number().int().min(0).nullable().optional(),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  categoryId: z.string().trim().min(1, "Categoria é obrigatória."),
  brandId: z.string().trim().nullable().optional(),
  imageUrl: optionalUrl.nullable().optional(),
  status: z.nativeEnum(ProductStatus),
  available: z.boolean().default(true),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(80),
  slug: z.string().trim().min(1, "Slug é obrigatório.").max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens."),
});

export type AdminProductDTO = Pick<Product, "id" | "slug" | "name" | "description" | "longDescription" | "type" | "deliveryType" | "deliveryEstimate" | "searchTerms" | "duration" | "priceCents" | "costCents" | "featured" | "sortOrder" | "status" | "available" | "imageUrl"> & {
  category: Pick<Category, "id" | "name" | "slug">;
  brand: Pick<Brand, "id" | "name" | "slug"> | null;
  updatedAt: string;
};

export const adminProductDto = (product: Product & { category: Category; brand: Brand | null }): AdminProductDTO => ({
  id: product.id, slug: product.slug, name: product.name, description: product.description,
  longDescription: product.longDescription, deliveryType: product.deliveryType,
  deliveryEstimate: product.deliveryEstimate, searchTerms: product.searchTerms,
  type: product.type, duration: product.duration, priceCents: product.priceCents,
  costCents: product.costCents, featured: product.featured, sortOrder: product.sortOrder,
  status: product.status, available: product.available, imageUrl: product.imageUrl,
  category: { id: product.category.id, name: product.category.name, slug: product.category.slug },
  brand: product.brand ? { id: product.brand.id, name: product.brand.name, slug: product.brand.slug } : null,
  updatedAt: product.updatedAt.toISOString(),
});

export const productStatuses = Object.values(ProductStatus);
export const productTypes = Object.values(ProductType);
export const deliveryTypes = Object.values(DeliveryType);
