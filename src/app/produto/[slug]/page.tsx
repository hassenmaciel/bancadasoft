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
import { balancePaymentOption } from "@/lib/balance-payment";
import { BALANCE_TOPUP_BLOCKED_MESSAGE, PIX_PRICE_UNAVAILABLE_MESSAGE } from "@/lib/commercial-pricing";

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

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ variante?: string | string[] }> }) {
  const viewer = await session();
  const requestedVariant = (await searchParams).variante;
  const [found, account] = await Promise.all([
    product((await params).slug),
    viewer
      ? prisma.user.findUnique({
          where: { id: viewer.id },
          select: {
            name: true,
            email: true,
            cpfCnpj: true,
            whatsapp: true,
            customerTier: true,
            canUseBalanceAsPayment: true,
            balanceTopupBlocked: true,
            accountBalance: { select: { enabled: true, balanceCents: true } },
          },
        })
      : null,
  ]);
  if (!found) notFound();
  // O saldo decide o preço exibido ao PREMIUM_PLUS (Premium Plus só se cobrir).
  const dto = productDto(found, viewer, account?.accountBalance ?? null);
  // PARTE 1/3/4: resumo mascarado da identidade para pular o formulário do
  // cliente já cadastrado — nunca envia CPF/e-mail/WhatsApp em texto puro
  // para o client, apenas o suficiente para exibir e decidir o que falta.
  const checkoutIdentity = account ? buildCheckoutIdentitySummary(account) : null;
  // Fase 5: só o saldo disponível vai para o client, e só quando o cliente
  // pode pagar com saldo neste produto (ver src/lib/balance-payment.ts).
  const balancePayment = balancePaymentOption(account, found.type);
  const variantPrices = dto.variants.flatMap((variant) => variant.priceCents === null ? [] : [variant.priceCents]);
  const displayPrice = variantPrices.length ? Math.min(...variantPrices) : dto.priceCents;
  const money = displayPrice === null ? null : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(displayPrice / 100);
  const unlockTool = dto.slug === "unlocktool-6h";
  // Recarga bloqueada pelo Admin: sem preço e sem pacote (o checkout também
  // recusa com BALANCE_TOPUP_BLOCKED).
  const topupBlocked = found.type === "BALANCE_TOPUP" && account?.balanceTopupBlocked === true;
  // PREMIUM_PLUS sem saldo que cubra e sem preço Premium/Técnico ativo: não há
  // como comprar (PIX recusado no servidor) — aviso em vez de preço.
  const premiumPlusNoPrice = dto.priceVisible && displayPrice === null && dto.priceTier === "PREMIUM_PLUS";
  const tierLabel =
    dto.priceTier === "PREMIUM_PLUS" ? (dto.priceMode === "balance" ? "Preço Premium Plus · " : "")
      : dto.priceTier === "PREMIUM" ? "Preço Premium · " : "";
  return <main><PublicHeader viewer={publicViewer(viewer)}/><section className="product-page wrap">
    <nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><Link href="/catalogo">Catálogo</Link><span>›</span><b>{dto.name}</b></nav>
    <div className="product-detail"><div className="product-detail-art">{dto.imageUrl?<Image src={dto.imageUrl} alt={dto.name} fill sizes="(max-width: 900px) 100vw, 500px" preload unoptimized={!isOptimizableImage(dto.imageUrl)}/>:<span>{dto.name.slice(0,3).toUpperCase()}</span>}</div>
      <div className="product-detail-copy"><span className="product-type">{dto.category?.name??dto.type}</span><h1>{unlockTool?"UnlockTool — Aluguel 6 horas":dto.name}</h1>{isUnlockToolLicense(dto)&&<p className="detail-subtitle">{dto.description}</p>}{dto.brand&&<p className="detail-brand">Marca: <b>{dto.brand.name}</b></p>}<p className="detail-description">{dto.longDescription||dto.description}</p>
        {unlockTool&&<ul className="product-guidance"><li>Produto digital com acesso temporário por 6 horas.</li><li>Liberação automática após a confirmação do pagamento e do fornecedor.</li><li>As credenciais ficam disponíveis com segurança em Meus Pedidos.</li><li>Não compartilhe as credenciais de acesso.</li></ul>}
        {dto.duration&&<div className="detail-line"><b>Modalidade</b><span>{dto.duration}</span></div>}
        <div className="detail-line"><b>Entrega</b><span>{dto.deliveryType==="ON_REQUEST"?"Sob consulta":dto.deliveryType==="AUTOMATIC"?"Automática":dto.deliveryType==="IMMEDIATE"?"Imediata":"Manual"}{dto.deliveryEstimate?` · ${dto.deliveryEstimate}`:""}</span></div>
        {topupBlocked ? <p className="notice balance-disabled" role="status">{BALANCE_TOPUP_BLOCKED_MESSAGE}</p> : <><div className="detail-availability">✓ Disponível para compra</div>{money ? <strong className="detail-price">{dto.variants.length ? "A partir de " : ""}{tierLabel}{money}</strong> : premiumPlusNoPrice ? <p className="product-balance-shortfall" role="status">{PIX_PRICE_UNAVAILABLE_MESSAGE} <Link href="/minha-conta/saldo">Recarregar saldo</Link></p> : <strong className="detail-price">Preço exclusivo para cadastrados</strong>}
        {premiumPlusNoPrice ? null : dto.priceVisible && money ? <CheckoutPanel product={dto} identity={checkoutIdentity} balancePayment={balancePayment} initialVariantId={typeof requestedVariant === "string" ? requestedVariant : null}/> : <div className="login-price-gate"><p>Entre ou cadastre-se para ver o preço e contratar este serviço.</p><Link className="product-cta" href={`/login?next=${encodeURIComponent(`/produto/${dto.slug}`)}`}>Entrar</Link><Link href={`/cadastro?next=${encodeURIComponent(`/produto/${dto.slug}`)}`}>Criar conta</Link></div>}</>}
        {dto.downloadUrl && <a className="product-cta product-download-link" href={dto.downloadUrl} target="_blank" rel="noopener noreferrer">{dto.downloadLabel || "Baixar ferramenta"}</a>}
        <small className="checkout-note">Pagamento processado em ambiente seguro. Confira as condições exibidas antes de concluir.</small>
      </div>
    </div>
  </section><PublicFooter/></main>;
}
