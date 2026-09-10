import { ProductStatus, ProductType, type Category, type Product } from "@prisma/client";
import { z } from "zod";

const optionalUrl = z.union([z.string().url("Informe uma URL válida."), z.literal("")]).transform((value) => value || null);

export const productInputSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(120),
  slug: z.string().trim().min(1, "Slug é obrigatório.").max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens."),
  description: z.string().trim().min(1, "Descrição é obrigatória.").max(500),
  type: z.nativeEnum(ProductType),
  duration: z.string().trim().max(80).nullable().optional(),
  priceCents: z.number().int().min(0, "O preço não pode ser negativo."),
  categoryId: z.string().trim().min(1, "Categoria é obrigatória."),
  imageUrl: optionalUrl.nullable().optional(),
  status: z.nativeEnum(ProductStatus),
  available: z.boolean().default(true),
});

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório.").max(80),
  slug: z.string().trim().min(1, "Slug é obrigatório.").max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use letras minúsculas, números e hífens."),
});

export type AdminProductDTO = Pick<Product, "id" | "slug" | "name" | "description" | "type" | "duration" | "priceCents" | "status" | "available" | "imageUrl"> & {
  category: Pick<Category, "id" | "name" | "slug">;
  updatedAt: string;
};

export const adminProductDto = (product: Product & { category: Category }): AdminProductDTO => ({
  id: product.id, slug: product.slug, name: product.name, description: product.description,
  type: product.type, duration: product.duration, priceCents: product.priceCents,
  status: product.status, available: product.available, imageUrl: product.imageUrl,
  category: { id: product.category.id, name: product.category.name, slug: product.category.slug },
  updatedAt: product.updatedAt.toISOString(),
});

export const productStatuses = Object.values(ProductStatus);
export const productTypes = Object.values(ProductType);
