import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import CheckoutPanel from "@/components/checkout-panel";
import { prisma } from "@/lib/prisma";
import { productDto } from "@/lib/dto";

export const dynamic="force-dynamic";
async function product(slug:string){return prisma.product.findFirst({where:{slug,status:"PUBLISHED",available:true,category:{active:true}},include:{category:true,brand:true}})}
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata>{const p=await product((await params).slug);return p?{title:`${p.name} | BancadaSoft`,description:p.description}:{title:"Produto não encontrado | BancadaSoft"}}
export default async function ProductPage({params}:{params:Promise<{slug:string}>}){const p=await product((await params).slug);if(!p)notFound();const dto=productDto(p);const money=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(dto.priceCents/100);return <main><PublicHeader/><section className="product-page wrap"><nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><Link href="/catalogo">Catálogo</Link><span>›</span><b>{dto.name}</b></nav><div className="product-detail"><div className="product-detail-art">{dto.imageUrl?<Image src={dto.imageUrl} alt={dto.name} fill sizes="500px" unoptimized/>:<span>{dto.name.slice(0,3).toUpperCase()}</span>}</div><div className="product-detail-copy"><span className="product-type">{dto.category?.name??dto.type}</span><h1>{dto.name}</h1>{dto.brand&&<p className="detail-brand">Marca: <b>{dto.brand.name}</b></p>}<p className="detail-description">{dto.longDescription||dto.description}</p>{dto.duration&&<div className="detail-line"><b>Modalidade</b><span>{dto.duration}</span></div>}<div className="detail-line"><b>Entrega</b><span>{dto.deliveryType==="ON_REQUEST"?"Sob consulta":dto.deliveryType==="AUTOMATIC"?"Automática":dto.deliveryType==="IMMEDIATE"?"Imediata":"Manual"}{dto.deliveryEstimate?` · ${dto.deliveryEstimate}`:""}</span></div><div className="detail-availability">✓ Disponível para compra</div><strong className="detail-price">{money}</strong><CheckoutPanel product={dto}/><small className="checkout-note">Pagamento processado em ambiente seguro. Confira as condições exibidas antes de concluir.</small></div></div></section><PublicFooter/></main>}
