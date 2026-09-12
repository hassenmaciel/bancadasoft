"use client";

import { FormEvent, useState } from "react";
import type { PricingConfigurationInput } from "@/lib/pricing-admin";

const productTypes = ["TOOL", "RENTAL", "ACTIVATION", "LICENSE", "REMOTE_SERVICE", "CREDIT", "IMEI_SN", "FILE"] as const;
const roundingModes = ["NONE", "X_90", "X_99", "NEAREST_1", "NEAREST_5"] as const;
const numberOrNull = (value: FormDataEntryValue | null, factor = 1) => value === null || String(value).trim() === "" ? null : Math.round(Number(value) * factor);

export default function PricingSettingsForm({ initial }: { initial: PricingConfigurationInput }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const groups = new Map(initial.groupRules.map((rule) => [rule.productType, rule]));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const groupRules = productTypes.flatMap((productType) => {
      if (form.get(`group.${productType}.enabled`) !== "on") return [];
      return [{
        productType,
        exchangeBufferBps: numberOrNull(form.get(`group.${productType}.exchangeBuffer`), 100),
        targetMarginBps: numberOrNull(form.get(`group.${productType}.targetMargin`), 100),
        minimumProfitCents: numberOrNull(form.get(`group.${productType}.minimumProfit`), 100),
        minimumPriceCents: numberOrNull(form.get(`group.${productType}.minimumPrice`), 100),
        roundingMode: String(form.get(`group.${productType}.rounding`) || "") || null,
        additionalFeeCents: numberOrNull(form.get(`group.${productType}.additionalFee`), 100),
        additionalFeeBps: numberOrNull(form.get(`group.${productType}.additionalPercent`), 100),
      }];
    });
    const payload = {
      automaticEnabled: form.get("automaticEnabled") === "on",
      exchangeRateMicros: numberOrNull(form.get("exchangeRate"), 1_000_000),
      exchangeBufferBps: numberOrNull(form.get("exchangeBuffer"), 100) ?? 0,
      targetMarginBps: numberOrNull(form.get("targetMargin"), 100) ?? 0,
      minimumProfitCents: numberOrNull(form.get("minimumProfit"), 100) ?? 0,
      asaasFeeType: form.get("asaasFeeType"),
      asaasFixedFeeCents: numberOrNull(form.get("asaasFixedFee"), 100) ?? 0,
      asaasPercentBps: numberOrNull(form.get("asaasPercent"), 100) ?? 0,
      roundingMode: form.get("roundingMode"),
      minimumPriceCents: numberOrNull(form.get("minimumPrice"), 100) ?? 0,
      groupRules,
    };
    const response = await fetch("/api/admin/pricing/configuration", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json();
    setSaving(false);
    setMessage(response.ok ? "Configuração de preços salva e produtos automáticos recalculados." : body.error ?? "Não foi possível salvar.");
  }

  return <form className="admin-form pricing-settings" onSubmit={submit}>
    <header><h2>Motor de precificação</h2><p>Valores comerciais configuráveis. Nenhum preço manual é sobrescrito.</p></header>
    <label className="check-field"><input name="automaticEnabled" type="checkbox" defaultChecked={initial.automaticEnabled} /> Habilitar cálculo automático</label>
    <div className="form-grid">
      <label>Câmbio USD → BRL<input name="exchangeRate" type="number" min="0.000001" step="0.000001" defaultValue={initial.exchangeRateMicros == null ? "" : initial.exchangeRateMicros / 1_000_000} /></label>
      <label>Buffer de câmbio (%)<input name="exchangeBuffer" type="number" min="0" max="99.99" step="0.01" defaultValue={initial.exchangeBufferBps / 100} /></label>
      <label>Margem alvo sobre venda (%)<input name="targetMargin" type="number" min="0" max="99.99" step="0.01" defaultValue={initial.targetMarginBps / 100} /></label>
      <label>Lucro mínimo (R$)<input name="minimumProfit" type="number" min="0" step="0.01" defaultValue={initial.minimumProfitCents / 100} /></label>
      <label>Preço mínimo global (R$)<input name="minimumPrice" type="number" min="0" step="0.01" defaultValue={initial.minimumPriceCents / 100} /></label>
      <label>Arredondamento<select name="roundingMode" defaultValue={initial.roundingMode}>{roundingModes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
    </div>
    <fieldset><legend>Taxa Asaas real / Production</legend><div className="form-grid">
      <label>Tipo<select name="asaasFeeType" defaultValue={initial.asaasFeeType}><option value="FIXED">Fixa</option><option value="PERCENTAGE">Percentual</option><option value="COMBINED">Fixa + percentual</option></select></label>
      <label>Taxa fixa (R$)<input name="asaasFixedFee" type="number" min="0" step="0.01" defaultValue={initial.asaasFixedFeeCents / 100} /></label>
      <label>Taxa percentual (%)<input name="asaasPercent" type="number" min="0" max="99.99" step="0.01" defaultValue={initial.asaasPercentBps / 100} /></label>
    </div></fieldset>
    <fieldset><legend>Regras por grupo</legend><p className="security-note">Campos vazios herdam a regra global.</p><div className="pricing-groups">
      {productTypes.map((productType) => {
        const rule = groups.get(productType);
        return <details key={productType}><summary><label className="check-field"><input name={`group.${productType}.enabled`} type="checkbox" defaultChecked={!!rule} /> {productType}</label></summary><div className="form-grid">
          <label>Buffer (%)<input name={`group.${productType}.exchangeBuffer`} type="number" min="0" max="99.99" step="0.01" defaultValue={rule?.exchangeBufferBps == null ? "" : rule.exchangeBufferBps / 100} /></label>
          <label>Margem alvo (%)<input name={`group.${productType}.targetMargin`} type="number" min="0" max="99.99" step="0.01" defaultValue={rule?.targetMarginBps == null ? "" : rule.targetMarginBps / 100} /></label>
          <label>Lucro mínimo (R$)<input name={`group.${productType}.minimumProfit`} type="number" min="0" step="0.01" defaultValue={rule?.minimumProfitCents == null ? "" : rule.minimumProfitCents / 100} /></label>
          <label>Preço mínimo (R$)<input name={`group.${productType}.minimumPrice`} type="number" min="0" step="0.01" defaultValue={rule?.minimumPriceCents == null ? "" : rule.minimumPriceCents / 100} /></label>
          <label>Arredondamento<select name={`group.${productType}.rounding`} defaultValue={rule?.roundingMode ?? ""}><option value="">Herdar global</option>{roundingModes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
          <label>Taxa adicional fixa (R$)<input name={`group.${productType}.additionalFee`} type="number" min="0" step="0.01" defaultValue={rule?.additionalFeeCents == null ? "" : rule.additionalFeeCents / 100} /></label>
          <label>Taxa adicional (%)<input name={`group.${productType}.additionalPercent`} type="number" min="0" max="99.99" step="0.01" defaultValue={rule?.additionalFeeBps == null ? "" : rule.additionalFeeBps / 100} /></label>
        </div></details>;
      })}
    </div></fieldset>
    {message && <p className="form-message">{message}</p>}
    <div className="form-actions"><button className="admin-primary" disabled={saving}>{saving ? "Salvando..." : "Salvar precificação"}</button></div>
  </form>;
}
