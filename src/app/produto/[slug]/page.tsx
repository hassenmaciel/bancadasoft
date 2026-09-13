import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import CheckoutPanel from "@/components/checkout-panel";
import { prisma } from "@/lib/prisma";
import { productDto } from "@/lib/dto";

export const dynamic = "force-dynamic";

async function product(slug: string) {
  return prisma.product.findFirst({
    where: { slug, status: "PUBLISHED", available: true, category: { active: true } },
    include: {
      category: true,
      brand: true,
      providerProducts: { where: { active: true, mode: "REAL" }, include: { provider: true } },
      variants: {
        include: { providerProduct: { include: { provider: true } } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = await product((await params).slug);
  return found
    ? { title: `${found.name} | BancadaSoft`, description: found.description }
    : { title: "Produto não encontrado | BancadaSoft" };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = await product((await params).slug);
  if (!found) notFound();
  const dto = productDto(found);
  const displayPrice = dto.variants.length
    ? Math.min(...dto.variants.map((variant) => variant.priceCents))
    : dto.priceCents;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(displayPrice / 100);
  const unlockTool = dto.slug === "unlocktool-6h";
  return <main><PublicHeader/><section className="product-page wrap">
    <nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><Link href="/catalogo">Catálogo</Link><span>›</span><b>{dto.name}</b></nav>
    <div className="product-detail"><div className="product-detail-art">{dto.imageUrl?<Image src={dto.imageUrl} alt={dto.name} fill sizes="500px" unoptimized/>:<span>{dto.name.slice(0,3).toUpperCase()}</span>}</div>
      <div className="product-detail-copy"><span className="product-type">{dto.category?.name??dto.type}</span><h1>{unlockTool?"UnlockTool — Aluguel 6 horas":dto.name}</h1>{dto.brand&&<p className="detail-brand">Marca: <b>{dto.brand.name}</b></p>}<p className="detail-description">{dto.longDescription||dto.description}</p>
        {unlockTool&&<ul className="product-guidance"><li>Produto digital com acesso temporário por 6 horas.</li><li>Liberação automática após a confirmação do pagamento e do fornecedor.</li><li>As credenciais ficam disponíveis com segurança em Meus Pedidos.</li><li>Não compartilhe as credenciais de acesso.</li></ul>}
        {dto.duration&&<div className="detail-line"><b>Modalidade</b><span>{dto.duration}</span></div>}
        <div className="detail-line"><b>Entrega</b><span>{dto.deliveryType==="ON_REQUEST"?"Sob consulta":dto.deliveryType==="AUTOMATIC"?"Automática":dto.deliveryType==="IMMEDIATE"?"Imediata":"Manual"}{dto.deliveryEstimate?` · ${dto.deliveryEstimate}`:""}</span></div>
        <div className="detail-availability">✓ Disponível para compra</div><strong className="detail-price">{dto.variants.length ? "A partir de " : ""}{money}</strong>
        <CheckoutPanel product={dto}/><small className="checkout-note">Pagamento processado em ambiente seguro. Confira as condições exibidas antes de concluir.</small>
      </div>
    </div>
  </section><PublicFooter/></main>;
}
