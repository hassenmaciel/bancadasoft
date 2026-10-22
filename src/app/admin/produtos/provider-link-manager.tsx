"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminProductDTO } from "@/lib/admin-catalog";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";

type LinkOption = { id: string; label: string };

const cost = (cents: number | null, currency: string) =>
  cents === null
    ? "Não informado"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD" }).format(cents / 100);

// Vínculo direto do produto (sem variantes) com um item do fornecedor. Salvo
// pela rota própria /provider-link, separado do formulário do produto.
export default function ProviderLinkManager({ product, options }: { product: AdminProductDTO; options: LinkOption[] }) {
  const router = useRouter();
  const current = product.providerProducts[0] ?? null;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const removalLocked = product.status === "PUBLISHED" && product.deliveryType === "AUTOMATIC";
  const send = async (providerProductId: string | null) => {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/admin/products/${product.id}/provider-link`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerProductId }),
    });
    const result = await response.json();
    setBusy(false);
    setConfirming(false);
    if (!response.ok) return setMessage(result.error ?? "Não foi possível atualizar o produto do fornecedor.");
    setMessage(providerProductId ? "Produto do fornecedor vinculado." : "Vínculo removido.");
    router.refresh();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = String(new FormData(event.currentTarget).get("providerProductId") ?? "");
    if (selected) void send(selected);
  };
  return <fieldset>
    <legend>Produto do fornecedor</legend>
    {current ? <div className="provider-data">
      <b>Vínculo atual</b>
      <dl>
        <div><dt>Nome no fornecedor</dt><dd>{current.label ?? "Sem nome"}</dd></div>
        <div><dt>ID externo</dt><dd>{current.externalProductId}</dd></div>
        <div><dt>Fornecedor</dt><dd>{current.provider.name}</dd></div>
        <div><dt>Custo</dt><dd>{cost(current.providerCostCents, current.currency)}</dd></div>
        <div><dt>Automação</dt><dd>{current.automationClass} · {current.technicalEligibility} · {current.homologationStatus}</dd></div>
        <div><dt>Entrega esperada</dt><dd>{current.expectedDeliveryType}</dd></div>
      </dl>
    </div> : <p className="security-note">Nenhum produto do fornecedor vinculado. Produto de entrega automática só pode ser publicado com um vínculo.</p>}
    <form className="provider-data" onSubmit={submit}>
      <label>{current ? "Trocar por" : "Vincular item"}<select name="providerProductId" defaultValue={current && options.some((option) => option.id === current.id) ? current.id : ""} required>
        <option value="">Selecione</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select></label>
      <small>Somente itens ativos, REAL, READY, de fornecedor ativo e sem vínculo com outro produto ou variante.</small>
      <div className="form-actions">
        {current && <button type="button" className="admin-danger-outline" disabled={busy || removalLocked} onClick={() => setConfirming(true)}>Remover vínculo</button>}
        <button className="admin-primary" disabled={busy}>{busy ? "Salvando..." : current ? "Trocar vínculo" : "Vincular"}</button>
      </div>
      {current && removalLocked && <small>Produto publicado com entrega automática: pause o produto antes de remover o vínculo.</small>}
    </form>
    {message && <p className="form-message">{message}</p>}
    <AdminConfirmDialog
      open={confirming}
      title="Remover o produto do fornecedor?"
      description={`O produto deixa de estar ligado a ${current?.label ?? "este item"} (ID ${current?.externalProductId ?? "—"}). Pedidos já criados não mudam.`}
      busy={busy}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void send(null)}
    />
  </fieldset>;
}
