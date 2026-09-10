import { prisma } from "@/lib/prisma";
import { adminProductDto } from "@/lib/admin-catalog";
import ProductList from "./product-list";

export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ include: { category: true }, orderBy: { updatedAt: "desc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  return <ProductList initialProducts={products.map(adminProductDto)} categories={categories.map(({ id, name }) => ({ id, name }))} />;
}
