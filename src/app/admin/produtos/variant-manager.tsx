"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminVariantDTO } from "@/lib/admin-catalog";
import { premiumPlusPriceWarning } from "@/lib/commercial-pricing";

type ProviderOption = { id: string; label: string };

const slugify = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const reais = (cents: number | null) => cents == null ? "" : String(cents / 100);
const cents = (value: string) => value ? Math.round(Number(value) * 100) : null;

// Premium e Premium Plus lado a lado; o aviso compara com o preço salvo da
// variante quando o Premium está vazio. Só aviso, nunca bloqueia o salvamento.
function TierPriceFields({ variant }: { variant?: AdminVariantDTO }) {
  const [premium, setPremium] = useState(reais(variant?.premiumPriceCents ?? null));
  const [premiumPlus, setPremiumPlus] = useState(reais(variant?.premiumPlusPriceCents ?? null));
  const warning = premiumPlusPriceWarning({
    priceCents: variant?.priceCents ?? null,
    normalPriceCents: variant?.normalPriceCents ?? null,
    premiumPriceCents: cents(premium),
    premiumPlusPriceCents: cents(premiumPlus),
  });
  return <>
    <label>Preço Premium (R$)<input name="premiumPrice" type="number" min="0.01" step=".01" value={premium} onChange={(event) => setPremium(event.target.value)} placeholder="Usa Normal"/></label>
    <label>Preço Premium Plus (R$)<input name="premiumPlusPrice" type="number" min="0.01" step=".01" value={premiumPlus} onChange={(event) => setPremiumPlus(event.target.value)} placeholder="Usa Premium"/>{warning && <small className="price-warning" role="status">{warning}</small>}</label>
  </>;
}

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
  // Remonta o formulário de nova variante após salvar (zera os campos controlados).
  const [addFormKey, setAddFormKey] = useState(0);
  const save = async (event: FormEvent<HTMLFormElement>, variantId?: string) => {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const pricingMode = String(form.get("pricingMode"));
    const manual = String(form.get("manualPrice") ?? "");
    const normal = String(form.get("normalPrice") ?? "");
    const premium = String(form.get("premiumPrice") ?? "");
    const premiumPlus = String(form.get("premiumPlusPrice") ?? "");
    const payload = {
      providerProductId: form.get("providerProductId"),
      name: form.get("name"),
      code: form.get("code"),
      active: form.get("active") === "on",
      sortOrder: Number(form.get("sortOrder")),
      pricingMode,
      manualPriceCents: pricingMode === "MANUAL" && manual ? Math.round(Number(manual) * 100) : null,
      normalPriceCents: normal ? Math.round(Number(normal) * 100) : null,
      premiumPriceCents: premium ? Math.round(Number(premium) * 100) : null,
      premiumPlusPriceCents: premiumPlus ? Math.round(Number(premiumPlus) * 100) : null,
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
    if (!variantId) {
      event.currentTarget.reset();
      setAddFormKey((key) => key + 1);
    }
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
        <label>Preço Normal (R$)<input name="normalPrice" type="number" min="0.01" step=".01" defaultValue={reais(variant.normalPriceCents)}/></label>
        <TierPriceFields variant={variant}/>
        <label>Ordem<input name="sortOrder" type="number" min="0" defaultValue={variant.sortOrder}/></label>
      </div>
      <label className="check-field"><input name="active" type="checkbox" defaultChecked={variant.active}/> Variante ativa</label>
      {variant.publicationBlocked && <p className="form-message">HOLD: {variant.holdReason}</p>}
      <small>Preço efetivo: {variant.priceCents == null ? "não definido" : `R$ ${(variant.priceCents / 100).toFixed(2)}`} · Sugestão: {variant.suggestedPriceCents == null ? "—" : `R$ ${(variant.suggestedPriceCents / 100).toFixed(2)}`}</small>
      <button className="admin-primary">Salvar variante</button>
    </form>)}
    <form className="provider-data" key={addFormKey} onSubmit={(event) => save(event)}>
      <b>Adicionar variante</b>
      <div className="form-grid">
        <label>Nome comercial<input name="name" required onChange={(event) => { const form=event.currentTarget.form; if(form) (form.elements.namedItem("code") as HTMLInputElement).value=slugify(event.target.value); }}/></label>
        <label>Código interno<input name="code" required/></label>
      </div>
      <label>Produto do fornecedor<select name="providerProductId" required><option value="">Selecione</option>{providerOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <div className="form-grid">
        <label>Preço<select name="pricingMode" defaultValue="AUTO_GLOBAL"><option value="AUTO_GLOBAL">Automático global</option><option value="AUTO_GROUP">Automático do grupo</option><option value="MANUAL">Manual</option></select></label>
        <label>Preço manual (R$)<input name="manualPrice" type="number" min="0.01" step=".01"/></label>
        <label>Preço Normal (R$)<input name="normalPrice" type="number" min="0.01" step=".01"/></label>
        <TierPriceFields/>
        <label>Ordem<input name="sortOrder" type="number" min="0" defaultValue="0"/></label>
      </div>
      <label className="check-field"><input name="active" type="checkbox" defaultChecked/> Variante ativa</label>
      <button className="admin-primary">Adicionar variante</button>
    </form>
    {message && <p className="form-message">{message}</p>}
  </fieldset>;
}
