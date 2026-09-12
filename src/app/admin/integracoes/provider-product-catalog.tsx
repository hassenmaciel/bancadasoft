"use client";

import { useMemo, useState } from "react";

export type ProviderCatalogRow = {
  id: string; externalProductId: string; label: string | null; providerCostCents: number | null; currency: string;
  mode: string; operational: boolean; automationClass: string; technicalEligibility: string; homologationStatus: string;
  metadata: unknown; product: { id: string; name: string; slug: string } | null;
};
const meta = (value: unknown, key: string) => typeof value === "object" && value && key in value ? String((value as Record<string, unknown>)[key] ?? "") : "";
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);

export default function ProviderProductCatalog({ products }: { products: ProviderCatalogRow[] }) {
  const [query, setQuery] = useState("");
  const [automation, setAutomation] = useState("ALL");
  const [homologation, setHomologation] = useState("ALL");
  const filtered = useMemo(() => products.filter((product) =>
    (automation === "ALL" || product.automationClass === automation) &&
    (homologation === "ALL" || product.homologationStatus === homologation) &&
    `${product.externalProductId} ${product.label ?? ""} ${product.product?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  ), [products, query, automation, homologation]);
  return <div className="provider-links">
    <h3>Catálogo e contratos ({products.length})</h3>
    <div className="admin-filters">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ID ou produto" />
      <select value={automation} onChange={(event) => setAutomation(event.target.value)}><option value="ALL">Todas as automações</option>{["AUTO_CREDENTIAL", "AUTO_GENERIC_REPLAY", "AUTO_FIELD_BASED", "REMOTE_SESSION", "MANUAL_REVIEW", "UNSUPPORTED"].map((value) => <option key={value}>{value}</option>)}</select>
      <select value={homologation} onChange={(event) => setHomologation(event.target.value)}><option value="ALL">Todas as homologações</option>{["UNTESTED", "CLASS_VALIDATED", "PRODUCT_VALIDATED", "FAILED"].map((value) => <option key={value}>{value}</option>)}</select>
    </div>
    <p>{filtered.length} contrato(s) encontrado(s). Exibindo até 250 por vez.</p>
    {filtered.length ? <div className="provider-table"><div className="provider-row provider-row-head"><span>Produto</span><span>ID externo</span><span>Custo</span><span>Automação</span></div>{filtered.slice(0, 250).map((link) => <div className="provider-row" key={link.id}><span><b>{link.product?.name ?? "Não vinculado"}</b><small>{link.label ?? link.product?.slug ?? "Produto do fornecedor"}{meta(link.metadata, "providerTime") ? ` · ${meta(link.metadata, "providerTime")}` : ""}</small></span><code>{link.externalProductId}</code><span>{link.providerCostCents === null ? "Não informado" : money(link.providerCostCents, link.currency)}<small>{meta(link.metadata, "providerType") || "Tipo não informado"}</small></span><span><b>{link.automationClass}</b><small>{link.technicalEligibility} · {link.homologationStatus}</small></span></div>)}</div> : <p>Nenhum contrato corresponde aos filtros.</p>}
  </div>;
}
