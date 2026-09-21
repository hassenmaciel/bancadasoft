import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import PublicHeader from "@/components/public-header";
import { publicViewer } from "@/lib/public-viewer";
import PublicFooter from "@/components/public-footer";
import CredentialDelivery from "@/components/credential-delivery";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { customerDelivery, customerOrderState } from "@/lib/customer-delivery";
import { isUnlockToolLicense } from "@/lib/unlocktool-license";
import { customerVisibleEvents } from "@/lib/dto";

export const metadata: Metadata = { title: "Detalhes do pedido | BancadaSoft", robots: { index: false, follow: false } };
const money = (value:number) => new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" }).format(value / 100);

export default async function OrderPage({ params }:{ params:Promise<{id:string}> }) {
  const { id } = await params;
  let user;
  try { user = await requireUser(); } catch { redirect(`/login?next=${encodeURIComponent(`/meus-pedidos/${id}`)}`); }
  const order = await prisma.order.findFirst({ where:{ id, ...user.role !== "ADMIN" && { customerId:user.id } }, include:{ items:{ include:{product:{ include:{brand:true} }} }, payment:true, fulfillment:true, events:{orderBy:{createdAt:"asc"}} } });
  if (!order) notFound();
  const delivery = customerDelivery(order.fulfillment?.delivery);
  return <main><PublicHeader viewer={publicViewer(user)}/><section className="customer-page wrap">
    <nav className="breadcrumbs"><Link href="/catalogo">Catálogo</Link><span>›</span><Link href="/meus-pedidos">Meus pedidos</Link><span>›</span><b>{order.publicToken.slice(0,8).toUpperCase()}</b></nav>
    <header><span className="eyebrow dark">Pedido</span><h1>{order.publicToken.slice(0,8).toUpperCase()}</h1><p>Criado em {new Intl.DateTimeFormat("pt-BR",{dateStyle:"long",timeStyle:"short"}).format(order.createdAt)}</p></header>
    <div className="order-detail-grid"><section className="order-detail-card"><h2>Itens</h2>{order.items.map(item=><div className="detail-item" key={item.id}><div><b>{item.product.name}</b><span>{item.product.duration || item.product.description}</span></div><strong>{money(item.unitPriceCents)}</strong></div>)}<div className="detail-total"><span>Total</span><b>{money(order.totalCents)}</b></div></section>
    <aside className="order-detail-card"><h2>Acompanhamento</h2><p><span>Estado atual</span><b>{customerOrderState(order.status,order.payment?.status,order.fulfillment?.status)}</b></p><p><span>Pagamento</span><b>{order.payment?.status ?? "Não iniciado"}</b></p><p><span>Processamento</span><b>{order.fulfillment?.status ?? "Aguardando pagamento"}</b></p>{delivery ? <CredentialDelivery {...delivery} licenseActivation={order.items.some(item=>isUnlockToolLicense(item.product))}/> : null}</aside></div>
    <section className="order-history"><h2>Histórico</h2><ol>{customerVisibleEvents(order.events).map((event,index)=><li key={`${event.createdAt.getTime()}-${index}`}><b>{event.status}</b><span>{event.note}</span><time>{new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(event.createdAt)}</time></li>)}</ol></section>
  </section><PublicFooter/></main>;
}
