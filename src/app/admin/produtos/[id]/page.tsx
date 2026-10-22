import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { adminProductDto } from "@/lib/admin-catalog";
import ProductForm from "../product-form";
import { calculateProductPricing, loadPricingContext } from "@/lib/pricing-service";
import { linkCandidateWhere } from "@/lib/admin-provider-link";

const cost = (cents: number | null, currency: string) =>
  cents === null ? "custo não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" }).format(cents / 100);

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: { category: true, brand: true, providerProducts: { include: { provider: true } }, variants: { include: { providerProduct: { include: { provider: true } } } } },
  });
  if (!product) notFound();

  const [categories, brands, pricingContext, providerProducts, linkOptions] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.brand.findMany({ orderBy: { name: "asc" } }),
    loadPricingContext(),
    prisma.providerProduct.findMany({
      where:{active:true,mode:"REAL",technicalEligibility:"READY",provider:{active:true},OR:[{variants:{none:{}}},{variants:{some:{productId:id}}}]},
      include:{provider:true},orderBy:{label:"asc"},
    }),
    // Vínculo direto só existe em produto sem variantes.
    product.variants.length
      ? []
      : prisma.providerProduct.findMany({ where: linkCandidateWhere(id), include: { provider: true }, orderBy: { label: "asc" } }),
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
        providerOptions={providerProducts.map(link=>({id:link.id,label:`${link.provider.name} · ${link.externalProductId} · ${link.label??"Sem nome"}`}))}
        providerLinkOptions={linkOptions.map((link) => ({ id: link.id, label: `${link.label ?? "Sem nome"} · ID ${link.externalProductId} · ${cost(link.providerCostCents, link.currency)}` }))}
      />
    </>
  );
}
