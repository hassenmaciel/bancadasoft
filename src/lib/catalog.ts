import { ProductStatus } from "@prisma/client";

export const publicProductWhere = { status: ProductStatus.PUBLISHED, available: true } as const;

export const isPublicProduct = (product: { status: ProductStatus; available: boolean }) =>
  product.status === ProductStatus.PUBLISHED && product.available;
