"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminVariantDTO } from "@/lib/admin-catalog";

type ProviderOption = { id: string; label: string };

const slugify = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const reais = (cents: number | null) => cents == null ? "" : String(cents / 100);

export default function VariantManager({
  productId,
  variants,
  providerOptions,
}: {
  productId: string;
  variants: AdminVariantDTO[];
  providerOptions: ProviderOption[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const save = async (event: FormEvent<HTMLFormElement>, variantId?: string) => {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const pricingMode = String(form.get("pricingMode"));
    const manual = String(form.get("manualPrice") ?? "");
    const payload = {
      providerProductId: form.get("providerProductId"),
      name: form.get("name"),
      code: form.get("code"),
      active: form.get("active") === "on",
      sortOrder: Number(form.get("sortOrder")),
      pricingMode,
      manualPriceCents: pricingMode === "MANUAL" && manual ? Math.round(Number(manual) * 100) : null,
    };
    const response = await fetch(
      variantId
        ? `/api/admin/products/${productId}/variants/${variantId}`
        : `/api/admin/products/${productId}/variants`,
      { method: variantId ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) },
    );
    const result = await response.json();
    if (!response.ok) return setMessage(result.error ?? "Não foi possível salvar a variante.");
    setMessage("Variante salva com sucesso.");
    router.refresh();
    if (!variantId) event.currentTarget.reset();
  };
  return <fieldset>
    <legend>Variantes comerciais</legend>
    <p className="security-note">Cada variante utiliza exatamente um produto do fornecedor. Custos e identificadores permanecem somente no Admin.</p>
    {variants.map((variant) => <form className="provider-data" key={variant.id} onSubmit={(event) => save(event, variant.id)}>
      <div className="form-grid">
        <label>Nome comercial<input name="name" defaultValue={variant.name} required/></label>
        <label>Código interno<input name="code" defaultValue={variant.code} required/></label>
      </div>
      <label>Produto do fornecedor<select name="providerProductId" defaultValue={variant.providerProduct.id} required>
        <option value={variant.providerProduct.id}>{variant.providerProduct.provider.name} · {variant.providerProduct.externalProductId} · {variant.providerProduct.label}</option>
        {providerOptions.filter(option => option.id !== variant.providerProduct.id).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select></label>
      <div className="form-grid">
        <label>Preço<select name="pricingMode" defaultValue={variant.pricingMode}><option value="AUTO_GLOBAL">Automático global</option><option value="AUTO_GROUP">Automático do grupo</option><option value="MANUAL">Manual</option></select></label>
        <label>Preço manual (R$)<input name="manualPrice" type="number" min="0.01" step=".01" defaultValue={reais(variant.manualPriceCents)}/></label>
        <label>Ordem<input name="sortOrder" type="number" min="0" defaultValue={variant.sortOrder}/></label>
      </div>
      <label className="check-field"><input name="active" type="checkbox" defaultChecked={variant.active}/> Variante ativa</label>
      {variant.publicationBlocked && <p className="form-message">HOLD: {variant.holdReason}</p>}
      <small>Preço efetivo: {variant.priceCents == null ? "não definido" : `R$ ${(variant.priceCents / 100).toFixed(2)}`} · Sugestão: {variant.suggestedPriceCents == null ? "—" : `R$ ${(variant.suggestedPriceCents / 100).toFixed(2)}`}</small>
      <button className="admin-primary">Salvar variante</button>
    </form>)}
    <form className="provider-data" onSubmit={(event) => save(event)}>
      <b>Adicionar variante</b>
      <div className="form-grid">
        <label>Nome comercial<input name="name" required onChange={(event) => { const form=event.currentTarget.form; if(form) (form.elements.namedItem("code") as HTMLInputElement).value=slugify(event.target.value); }}/></label>
        <label>Código interno<input name="code" required/></label>
      </div>
      <label>Produto do fornecedor<select name="providerProductId" required><option value="">Selecione</option>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <div className="form-grid">
        <label>Preço<select name="pricingMode" defaultValue="AUTO_GLOBAL"><option value="AUTO_GLOBAL">Automático global</option><option value="AUTO_GROUP">Automático do grupo</option><option value="MANUAL">Manual</option></select></label>
        <label>Preço manual (R$)<input name="manualPrice" type="number" min="0.01" step=".01"/></label>
        <label>Ordem<input name="sortOrder" type="number" min="0" defaultValue="0"/></label>
      </div>
      <label className="check-field"><input name="active" type="checkbox" defaultChecked/> Variante ativa</label>
      <button className="admin-primary">Adicionar variante</button>
    </form>
    {message && <p className="form-message">{message}</p>}
  </fieldset>;
}
