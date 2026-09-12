"use client";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminProductDTO } from "@/lib/admin-catalog";
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
    [pricingMode, setPricingMode] = useState("ALL"),
    [pricingStatus, setPricingStatus] = useState("ALL"),
    [marginBelow, setMarginBelow] = useState(""),
    [profitBelow, setProfitBelow] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [simulation, setSimulation] = useState<Record<string, unknown> | null>(null);
  const products = useMemo(
    () =>
      rows.filter(
        (p) =>
          (status === "ALL" || p.status === status) &&
          (category === "ALL" || p.category.id === category) &&
          (brand === "ALL" || p.brand?.id === brand) &&
          (type === "ALL" || p.type === type) &&
          (automation === "ALL" || p.providerProducts.some((link) => link.automationClass === automation)) &&
          (pricingMode === "ALL" || p.pricingMode === pricingMode) &&
          (pricingStatus === "ALL" || p.pricingStatus === pricingStatus) &&
          (marginBelow === "" || (p.pricing?.estimatedMarginBps ?? Infinity) < Number(marginBelow) * 100) &&
          (profitBelow === "" || (p.pricing?.estimatedProfitCents ?? Infinity) < Number(profitBelow) * 100) &&
          `${p.name} ${p.slug} ${p.searchTerms}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [rows, query, status, category, brand, type, automation, pricingMode, pricingStatus, marginBelow, profitBelow],
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
  async function bulkPricing(action: "APPLY_GLOBAL" | "APPLY_GROUP" | "REMOVE_MANUAL" | "RECALCULATE") {
    if (!selected.length || busy) return;
    if (action !== "RECALCULATE" && !window.confirm("Esta ação remove o preço manual dos produtos selecionados. Deseja continuar?")) return;
    setBusy(true);
    const response = await fetch("/api/admin/products/bulk", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: selected, action }) });
    const body = await response.json();
    if (response.ok && Array.isArray(body.data)) {
      const updated = new Map((body.data as AdminProductDTO[]).map((product) => [product.id, product]));
      setRows((current) => current.map((product) => updated.get(product.id) ?? product));
      setSelected([]);
    }
    setBusy(false);
  }
  async function simulate() {
    setBusy(true);
    const response = await fetch("/api/admin/pricing/simulate", { method: "POST" });
    const body = await response.json();
    setSimulation(response.ok ? body.data : { error: body.error ?? "Falha na simulação" });
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
        <select value={pricingMode} onChange={(e) => setPricingMode(e.target.value)}>
          <option value="ALL">Modo de preço</option>
          <option value="AUTO_GLOBAL">Automático global</option>
          <option value="AUTO_GROUP">Automático por grupo</option>
          <option value="MANUAL">Manual</option>
        </select>
        <select value={pricingStatus} onChange={(e) => setPricingStatus(e.target.value)}>
          <option value="ALL">Status de pricing</option>
          {['AUTO_OK', 'MANUAL', 'NEEDS_REVIEW', 'NO_COST', 'INVALID_CONFIG'].map((value) => <option key={value}>{value}</option>)}
        </select>
        <input value={marginBelow} onChange={(event) => setMarginBelow(event.target.value)} type="number" min="0" step="0.01" placeholder="Margem abaixo de %" />
        <input value={profitBelow} onChange={(event) => setProfitBelow(event.target.value)} type="number" step="0.01" placeholder="Lucro abaixo de R$" />
      </section>
      <section className="admin-filters">
        <button disabled={!selected.length || busy} onClick={() => bulk("PUBLISH")}>Publicar selecionados</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("DRAFT")}>Mover para rascunho</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("PAUSE")}>Pausar selecionados</button>
        <button disabled={!selected.length || busy} onClick={() => bulk("ARCHIVE")}>Arquivar selecionados</button>
      </section>
      <section className="admin-filters pricing-bulk-actions">
        <button disabled={!selected.length || busy} onClick={() => bulkPricing("APPLY_GLOBAL")}>Aplicar regra global</button>
        <button disabled={!selected.length || busy} onClick={() => bulkPricing("APPLY_GROUP")}>Aplicar regra do grupo</button>
        <button disabled={!selected.length || busy} onClick={() => bulkPricing("REMOVE_MANUAL")}>Remover preço manual</button>
        <button disabled={!selected.length || busy} onClick={() => bulkPricing("RECALCULATE")}>Recalcular sugestões</button>
        <button disabled={busy} onClick={simulate}>Simular catálogo completo</button>
      </section>
      {simulation && <section className="pricing-simulation"><h2>Simulação sem alterar preços públicos</h2><pre>{JSON.stringify(simulation, null, 2)}</pre></section>}
      <section className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Selecionar produtos exibidos" checked={products.length > 0 && products.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? products.map((product) => product.id) : [])} /></th>
              <th>Produto</th>
              <th>Provider</th>
              <th>Automação</th>
              <th>Grupo</th>
              <th>Cost original</th>
              <th>Cost BRL</th>
              <th>Suggested</th>
              <th>Effective</th>
              <th>Profit</th>
              <th>Margem</th>
              <th>Pricing</th>
              <th>Publicação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const providerCost = product.providerProducts.find((link) => link.providerCostCents !== null);
              const pricing = product.pricing;
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
                    {providerCost?.provider.name ?? "—"}
                    {providerCost && <small className="cell-subtitle">ID {providerCost.externalProductId}</small>}
                  </td>
                  <td>
                    {providerCost?.automationClass ?? "—"}
                  </td>
                  <td>{product.type}<small className="cell-subtitle">{product.category.name}</small></td>
                  <td>
                    {providerCost && providerCost.providerCostCents !== null ? (
                      <>
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: providerCost.currency,
                        }).format(providerCost.providerCostCents / 100)}
                        <small className="cell-subtitle">{providerCost.currency}</small>
                      </>
                    ) : "—"}
                  </td>
                  <td>{pricing?.providerCostBrlCents == null ? "—" : brl(pricing.providerCostBrlCents)}</td>
                  <td>{pricing?.suggestedPriceCents == null ? "—" : brl(pricing.suggestedPriceCents)}</td>
                  <td>{brl(product.priceCents)}<small className="cell-subtitle">{product.pricingMode === "MANUAL" ? "PREÇO MANUAL" : "AUTO"}</small></td>
                  <td>{pricing?.estimatedProfitCents == null ? "—" : brl(pricing.estimatedProfitCents)}</td>
                  <td>
                    {pricing?.estimatedMarginBps == null ? "—" : `${(pricing.estimatedMarginBps / 100).toFixed(2)}%`}
                  </td>
                  <td><span className={`status-badge pricing-${product.pricingStatus.toLowerCase()}`}>{product.pricingStatus}</span><small className="cell-subtitle">{product.pricingMode}</small></td>
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
