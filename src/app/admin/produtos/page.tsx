import { prisma } from "@/lib/prisma";
import { adminProductDto } from "@/lib/admin-catalog";
import { calculateProductPricing, loadPricingContext } from "@/lib/pricing-service";
import ProductList from "./product-list";

export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  const [products, categories, brands, pricingContext] = await Promise.all([
    prisma.product.findMany({ include: { category: true, brand: true, providerProducts: { include: { provider: true } }, variants: { include: { providerProduct: { include: { provider: true } } } } }, orderBy: { updatedAt: "desc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    loadPricingContext(),
  ]);
  return <ProductList initialProducts={products.map((product) => adminProductDto(product, calculateProductPricing(product, pricingContext)))} categories={categories.map(({ id, name }) => ({ id, name }))} brands={brands.map(({id,name})=>({id,name}))} />;
}
