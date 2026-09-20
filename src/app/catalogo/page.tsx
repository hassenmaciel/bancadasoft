import type { Metadata } from "next";
import Link from "next/link";
import PublicHeader from "@/components/public-header";
import { publicViewer } from "@/lib/public-viewer";
import PublicFooter from "@/components/public-footer";
import ProductCard from "@/components/product-card";
import { prisma } from "@/lib/prisma";
import { findPublicCatalog, popularPublicProducts } from "@/lib/catalog-search";
import { productDto as mapProductDto } from "@/lib/dto";
import { session } from "@/lib/auth";
import { parsePublicProductType } from "@/lib/public-navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catálogo | BancadaSoft", description: "Ferramentas, licenças, aluguéis e serviços para assistência técnica mobile." };

export default async function CatalogPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const viewer=await session();const productDto=(product:Parameters<typeof mapProductDto>[0])=>mapProductDto(product,viewer);
  const raw=await searchParams;const q=typeof raw.q==="string"?raw.q:"";const tipo=typeof raw.tipo==="string"?raw.tipo:"";const categoria=typeof raw.categoria==="string"?raw.categoria:"";const ordem=raw.ordem==="recentes"?"recent":raw.ordem==="nome"?"name":"priority";
  const popularOnly=raw.ordem==="populares";
  const products=popularOnly?(await popularPublicProducts(120)).products:await findPublicCatalog({query:q||undefined,type:parsePublicProductType(tipo),category:categoria||undefined,sort:ordem});
  const categories=await prisma.category.findMany({where:{active:true,products:{some:{status:"PUBLISHED",available:true}}},select:{name:true,slug:true},orderBy:{name:"asc"}});
  const types=[['','Todas'],['aluguel','Aluguéis'],['ativacao','Ativações'],['licenca','Licenças'],['credito','Créditos'],['imei','IMEI / SN'],['arquivo','Arquivos'],['servico','Serviços']];
  return <main><PublicHeader viewer={publicViewer(viewer)} initialQuery={q}/><section className="catalog-page wrap"><nav className="breadcrumbs" aria-label="Navegação estrutural"><Link href="/">Início</Link><span>›</span><b>Catálogo</b></nav><header className="catalog-head"><div><span className="eyebrow dark">Catálogo profissional</span><h1>Encontre a solução certa para sua bancada</h1><p>Pesquise e compare os produtos publicados disponíveis.</p></div><strong>{products.length} {products.length===1?'produto':'produtos'}</strong></header><form className="catalog-search" action="/catalogo"><input name="q" defaultValue={q} placeholder="Busque por nome, marca, serviço ou ferramenta"/><button>Buscar</button></form><div className="catalog-layout"><aside className="catalog-filters"><h2>Modalidade</h2>{types.map(([value,label])=><Link className={tipo===value?'active':''} href={`/catalogo?${new URLSearchParams({...q&&{q},...value&&{tipo:value}})}`} key={value}>{label}</Link>)}<h2>Categoria</h2><Link className={!categoria?'active':''} href={`/catalogo?${new URLSearchParams({...q&&{q},...tipo&&{tipo}})}`}>Todas</Link>{categories.map(item=><Link className={categoria===item.slug?'active':''} href={`/catalogo?${new URLSearchParams({...q&&{q},...tipo&&{tipo},categoria:item.slug})}`} key={item.slug}>{item.name}</Link>)}</aside><div className="catalog-results"><div className="catalog-sort"><span>{q&&<>Resultados para <b>“{q}”</b></>}</span><div>Ordenar: <Link href={`/catalogo?${new URLSearchParams({...q&&{q},...tipo&&{tipo},...categoria&&{categoria},ordem:'recentes'})}`}>Recentes</Link><Link href={`/catalogo?${new URLSearchParams({...q&&{q},...tipo&&{tipo},...categoria&&{categoria},ordem:'nome'})}`}>Nome</Link></div></div>{products.length?<div className="products catalog-products">{products.map((product,index)=><ProductCard key={product.id} product={productDto(product)} index={index} priority={index<3}/>)}</div>:<div className="empty-state"><b>Nenhum produto encontrado.</b><span>Tente outro termo ou remova algum filtro.</span></div>}</div></div></section><PublicFooter/></main>;
}
