import { prisma } from "@/lib/prisma";
import { adminProductDto } from "@/lib/admin-catalog";
import ProductList from "./product-list";

export const dynamic = "force-dynamic";
export default async function ProductsPage() {
  const products = await prisma.product.findMany({ include: { category: true, brand: true }, orderBy: { updatedAt: "desc" } });
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
  return <ProductList initialProducts={products.map(adminProductDto)} categories={categories.map(({ id, name }) => ({ id, name }))} brands={brands.map(({id,name})=>({id,name}))} />;
}
