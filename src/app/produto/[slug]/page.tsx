import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import { publicViewer } from "@/lib/public-viewer";
import PublicFooter from "@/components/public-footer";
import CheckoutPanel from "@/components/checkout-panel";
import { prisma } from "@/lib/prisma";
import { productDto } from "@/lib/dto";
import { isOptimizableImage } from "@/lib/image-source";
import { session } from "@/lib/auth";
import { buildCheckoutIdentitySummary } from "@/lib/checkout-identity";
import { isUnlockToolLicense } from "@/lib/unlocktool-license";

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
  const viewer = await session();
  const [found, account] = await Promise.all([
    product((await params).slug),
    viewer
      ? prisma.user.findUnique({
          where: { id: viewer.id },
          select: { name: true, email: true, cpfCnpj: true, whatsapp: true },
        })
      : null,
  ]);
  if (!found) notFound();
  const dto = productDto(found, viewer);
  // PARTE 1/3/4: resumo mascarado da identidade para pular o formulário do
  // cliente já cadastrado — nunca envia CPF/e-mail/WhatsApp em texto puro
  // para o client, apenas o suficiente para exibir e decidir o que falta.
  const checkoutIdentity = account ? buildCheckoutIdentitySummary(account) : null;
  const variantPrices = dto.variants.flatMap((variant) => variant.priceCents === null ? [] : [variant.priceCents]);
  const displayPrice = variantPrices.length ? Math.min(...variantPrices) : dto.priceCents;
  const money = displayPrice === null ? null : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(displayPrice / 100);
  const unlockTool = dto.slug === "unlocktool-6h";
  return <main><PublicHeader viewer={publicViewer(viewer)}/><section className="product-page wrap">
    <nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><Link href="/catalogo">Catálogo</Link><span>›</span><b>{dto.name}</b></nav>
    <div className="product-detail"><div className="product-detail-art">{dto.imageUrl?<Image src={dto.imageUrl} alt={dto.name} fill sizes="(max-width: 900px) 100vw, 500px" preload unoptimized={!isOptimizableImage(dto.imageUrl)}/>:<span>{dto.name.slice(0,3).toUpperCase()}</span>}</div>
      <div className="product-detail-copy"><span className="product-type">{dto.category?.name??dto.type}</span><h1>{unlockTool?"UnlockTool — Aluguel 6 horas":dto.name}</h1>{isUnlockToolLicense(dto)&&<p className="detail-subtitle">{dto.description}</p>}{dto.brand&&<p className="detail-brand">Marca: <b>{dto.brand.name}</b></p>}<p className="detail-description">{dto.longDescription||dto.description}</p>
        {unlockTool&&<ul className="product-guidance"><li>Produto digital com acesso temporário por 6 horas.</li><li>Liberação automática após a confirmação do pagamento e do fornecedor.</li><li>As credenciais ficam disponíveis com segurança em Meus Pedidos.</li><li>Não compartilhe as credenciais de acesso.</li></ul>}
        {dto.duration&&<div className="detail-line"><b>Modalidade</b><span>{dto.duration}</span></div>}
        <div className="detail-line"><b>Entrega</b><span>{dto.deliveryType==="ON_REQUEST"?"Sob consulta":dto.deliveryType==="AUTOMATIC"?"Automática":dto.deliveryType==="IMMEDIATE"?"Imediata":"Manual"}{dto.deliveryEstimate?` · ${dto.deliveryEstimate}`:""}</span></div>
        <div className="detail-availability">✓ Disponível para compra</div>{money ? <strong className="detail-price">{dto.variants.length ? "A partir de " : ""}{dto.priceTier === "PREMIUM" ? "Preço Premium · " : ""}{money}</strong> : <strong className="detail-price">Preço exclusivo para cadastrados</strong>}
        {dto.priceVisible && money ? <CheckoutPanel product={dto} identity={checkoutIdentity}/> : <div className="login-price-gate"><p>Entre ou cadastre-se para ver o preço e contratar este serviço.</p><Link className="product-cta" href={`/login?next=${encodeURIComponent(`/produto/${dto.slug}`)}`}>Entrar</Link><Link href={`/cadastro?next=${encodeURIComponent(`/produto/${dto.slug}`)}`}>Criar conta</Link></div>}
        {dto.downloadUrl && <a className="product-cta product-download-link" href={dto.downloadUrl} target="_blank" rel="noopener noreferrer">{dto.downloadLabel || "Baixar ferramenta"}</a>}
        <small className="checkout-note">Pagamento processado em ambiente seguro. Confira as condições exibidas antes de concluir.</small>
      </div>
    </div>
  </section><PublicFooter/></main>;
}
