"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminProductDTO } from "@/lib/admin-catalog";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
export default function ProductList({ initialProducts, categories }: { initialProducts: AdminProductDTO[]; categories: Array<{ id: string; name: string }> }) {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("ALL"); const [category, setCategory] = useState("ALL");
  const products = useMemo(() => initialProducts.filter((product) =>
    (status === "ALL" || product.status === status) && (category === "ALL" || product.category.id === category) &&
    product.name.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))), [initialProducts, query, status, category]);
  return <>
    <header className="admin-heading"><div><small>CATÁLOGO</small><h1>Produtos</h1><p>Gerencie os itens disponíveis na plataforma.</p></div><Link className="admin-primary" href="/admin/produtos/novo">Novo produto</Link></header>
    <section className="admin-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome" />
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">Todos os status</option>{["DRAFT","REVIEWED","PUBLISHED","PAUSED","ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select>
      <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="ALL">Todas as categorias</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    </section>
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Status</th><th>Atualizado</th><th /></tr></thead><tbody>{products.map((product) => <tr key={product.id}><td><div className="admin-product"><span className="admin-thumb">{product.imageUrl ? <Image src={product.imageUrl} alt="" width={42} height={42} unoptimized /> : product.name.slice(0,2).toUpperCase()}</span><div><b>{product.name}</b><small>{product.slug}</small></div></div></td><td>{product.category.name}</td><td>{money(product.priceCents)}</td><td><span className={`status-badge status-${product.status.toLowerCase()}`}>{product.status}</span></td><td>{new Date(product.updatedAt).toLocaleDateString("pt-BR")}</td><td><Link href={`/admin/produtos/${product.id}`}>Editar</Link></td></tr>)}</tbody></table>{!products.length && <p className="admin-empty">Nenhum produto encontrado.</p>}</section>
  </>;
}
