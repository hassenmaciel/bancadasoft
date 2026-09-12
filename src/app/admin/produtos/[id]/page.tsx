import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { adminProductDto } from "@/lib/admin-catalog";
import ProductForm from "../product-form";
import { calculateProductPricing, loadPricingContext } from "@/lib/pricing-service";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true, brand: true, providerProducts: { include: { provider: true } } },
  });
  if (!product) notFound();

  const [categories, brands, pricingContext] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    loadPricingContext(),
  ]);

  return (
    <>
      <header className="admin-heading">
        <div>
          <Link href="/admin/produtos">← Produtos</Link>
          <h1>Editar produto</h1>
          <p>Atualize dados comerciais e publicação.</p>
        </div>
      </header>
      <ProductForm
        product={adminProductDto(product, calculateProductPricing(product, pricingContext))}
        categories={categories.map(({ id: categoryId, name }) => ({ id: categoryId, name }))}
        brands={brands.map(({ id: brandId, name }) => ({ id: brandId, name }))}
      />
    </>
  );
}
