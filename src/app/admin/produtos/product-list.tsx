"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminProductDTO } from "@/lib/admin-catalog";
import { commercialMetrics } from "@/lib/admin-rules";
const brl = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
type Option = { id: string; name: string };
export default function ProductList({
  initialProducts,
  categories,
  brands,
}: {
  initialProducts: AdminProductDTO[];
  categories: Option[];
  brands: Option[];
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("ALL"),
    [category, setCategory] = useState("ALL"),
    [brand, setBrand] = useState("ALL"),
    [type, setType] = useState("ALL");
  const products = useMemo(
    () =>
      initialProducts.filter(
        (p) =>
          (status === "ALL" || p.status === status) &&
          (category === "ALL" || p.category.id === category) &&
          (brand === "ALL" || p.brand?.id === brand) &&
          (type === "ALL" || p.type === type) &&
          `${p.name} ${p.slug} ${p.searchTerms}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [initialProducts, query, status, category, brand, type],
  );
  return (
    <>
      <header className="admin-heading">
        <div>
          <small>CATÁLOGO</small>
          <h1>Produtos</h1>
          <p>
            Dados comerciais separados dos dados sincronizados do fornecedor.
          </p>
        </div>
        <Link className="admin-primary" href="/admin/produtos/novo">
          Novo produto
        </Link>
      </header>
      <section className="admin-filters product-filters">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar produto ou termo"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">Publicação</option>
          {["DRAFT", "REVIEWED", "PUBLISHED", "PAUSED", "ARCHIVED"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="ALL">Categorias</option>
          {categories.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="ALL">Marcas</option>
          {brands.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ALL">Tipos</option>
          {[
            "TOOL",
            "RENTAL",
            "ACTIVATION",
            "LICENSE",
            "CREDIT",
            "IMEI_SN",
            "FILE",
            "REMOTE_SERVICE",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </section>
      <section className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Categoria / Marca</th>
              <th>Entrega</th>
              <th>Preço BancadaSoft</th>
              <th>Custo</th>
              <th>Margem</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const providerCost = product.providerProducts.find(
                  (link) => link.providerCostCents !== null,
                ),
                metrics =
                  product.costCents === null
                    ? null
                    : commercialMetrics(product.priceCents, product.costCents);
              return (
                <tr key={product.id}>
                  <td>
                    <div className="admin-product">
                      <span className="admin-thumb">
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={product.name}
                            width={42}
                            height={42}
                            unoptimized
                          />
                        ) : (
                          product.name.slice(0, 2).toUpperCase()
                        )}
                      </span>
                      <div>
                        <b>{product.name}</b>
                        <small>
                          {product.slug}
                          {product.featured ? " · Destaque" : ""}
                        </small>
                        {providerCost && (
                          <small>
                            Integrado: {providerCost.provider.name} · ID{" "}
                            {providerCost.externalProductId}
                          </small>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {product.category.name}
                    <small className="cell-subtitle">
                      {product.brand?.name ?? "Sem marca"}
                    </small>
                  </td>
                  <td>
                    {product.deliveryType}
                    <small className="cell-subtitle">
                      {product.deliveryEstimate ?? "Sem override comercial"}
                    </small>
                  </td>
                  <td>{brl(product.priceCents)}</td>
                  <td>
                    {providerCost && providerCost.providerCostCents !== null ? (
                      <>
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: providerCost.currency,
                        }).format(providerCost.providerCostCents / 100)}
                        <small className="cell-subtitle">
                          Sincronizado do fornecedor
                        </small>
                      </>
                    ) : product.costCents === null ? (
                      "Não informado"
                    ) : (
                      brl(product.costCents)
                    )}
                  </td>
                  <td>
                    {metrics ? (
                      <>
                        {brl(metrics.profitCents)}
                        <small className="cell-subtitle">
                          {metrics.marginPercent.toFixed(2)}%
                        </small>
                      </>
                    ) : (
                      <span className="cell-subtitle">
                        Não calculada sem conversão cambial
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`status-badge status-${product.status.toLowerCase()}`}
                    >
                      {product.status}
                    </span>
                    <small className="cell-subtitle">
                      {product.available ? "Disponível" : "Indisponível"}
                    </small>
                  </td>
                  <td>
                    <Link href={`/admin/produtos/${product.id}`}>Editar</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!products.length && (
          <p className="admin-empty">Nenhum produto corresponde aos filtros.</p>
        )}
      </section>
    </>
  );
}
