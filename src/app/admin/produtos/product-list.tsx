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
  const [rows, setRows] = useState(initialProducts),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("ALL"),
    [category, setCategory] = useState("ALL"),
    [brand, setBrand] = useState("ALL"),
    [type, setType] = useState("ALL"),
    [automation, setAutomation] = useState("ALL"),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false);
  const products = useMemo(
    () =>
      rows.filter(
        (p) =>
          (status === "ALL" || p.status === status) &&
          (category === "ALL" || p.category.id === category) &&
          (brand === "ALL" || p.brand?.id === brand) &&
          (type === "ALL" || p.type === type) &&
          (automation === "ALL" || p.providerProducts.some((link) => link.automationClass === automation)) &&
          `${p.name} ${p.slug} ${p.searchTerms}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [rows, query, status, category, brand, type, automation],
  );
  async function bulk(action: "PUBLISH" | "DRAFT" | "PAUSE" | "ARCHIVE") {
    if (!selected.length || busy) return;
    setBusy(true);
    const response = await fetch("/api/admin/products/bulk", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selected, action }) });
    if (response.ok) {
      const nextStatus = { PUBLISH: "PUBLISHED", DRAFT: "DRAFT", PAUSE: "PAUSED", ARCHIVE: "ARCHIVED" }[action];
      setRows((current) => current.map((product) => selected.includes(product.id) ? { ...product, status: nextStatus as AdminProductDTO["status"] } : product));
      setSelected([]);
    }
    setBusy(false);
  }
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
        <select value={automation} onChange={(e) => setAutomation(e.target.value)}>
          <option value="ALL">Automação</option>
          <option value="AUTO_CREDENTIAL">Auto credenciais</option>
          <option value="AUTO_GENERIC_REPLAY">Auto replay</option>
          <option value="AUTO_FIELD_BASED">Campos dinâmicos</option>
          <option value="REMOTE_SESSION">Sessão remota</option>
          <option value="MANUAL_REVIEW">Revisão manual</option>
          <option value="UNSUPPORTED">Não suportado</option>
        </select>
      </section>
      <section className="admin-filters">
        <button disabled={!selected.length || busy} onClick={() => bulk("PUBLISH")}>Publicar selecionados</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("DRAFT")}>Mover para rascunho</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("PAUSE")}>Pausar selecionados</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("ARCHIVE")}>Arquivar selecionados</button>
      </section>
      <section className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Selecionar produtos exibidos" checked={products.length > 0 && products.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? products.map((product) => product.id) : [])} /></th>
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
                  <td><input type="checkbox" aria-label={`Selecionar ${product.name}`} checked={selected.includes(product.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, product.id])] : current.filter((id) => id !== product.id))} /></td>
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
                    {product.providerProducts[0] && <small className="cell-subtitle">{product.providerProducts[0].automationClass} · {product.providerProducts[0].homologationStatus}</small>}
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
