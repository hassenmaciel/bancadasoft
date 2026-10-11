"use client";

import { useEffect, useRef, useState } from "react";
import { deliveryHeading } from "@/lib/customer-delivery";
import type { DeliveryDTO } from "@/lib/dto";
import type { CustomerFieldEcho } from "@/lib/customer-field-echo";
import { LICENSE_DELIVERY_TEXT, LICENSE_DELIVERY_TITLE, licenseProviderReturn } from "@/lib/unlocktool-license";

type DeliveryField = { key: string; label: string; value: string; sensitive: boolean };
// licenseActivation só é true para a licença UnlockTool (ver isUnlockToolLicense):
// o retorno do fornecedor é apenas uma confirmação, não uma credencial.
// customerFields: echo do que o cliente informou no checkout (ver customer-field-echo.ts).
type Props = DeliveryDTO & { licenseActivation?: boolean; customerFields?: CustomerFieldEcho[] };

function CustomerFields({ fields }: { fields?: CustomerFieldEcho[] }) {
  if (!fields?.length) return null;
  return <dl className="customer-field-echo" aria-label="Dados informados no pedido">
    <dt>Dados informados no pedido</dt>
    {fields.map((field, index) => <dd key={`${field.key}-${index}`}><span>{field.label}</span> <strong>{field.value}</strong></dd>)}
  </dl>;
}

export default function CredentialDelivery({ deliveryType, title, username, password, credential, instructions, deliveryFields, licenseActivation, customerFields }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy(kind: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  }
  const fields: DeliveryField[] = deliveryFields?.length ? deliveryFields : [
    ...(username ? [{ key: "username", label: "Usuário/Login", value: username, sensitive: false }] : []),
    ...(password ? [{ key: "password", label: "Senha", value: password, sensitive: true }] : []),
    ...(credential ? [{ key: "credential", label: deliveryType === "LICENSE" ? "Licença" : "Código", value: credential, sensitive: true }] : []),
  ];
  if (licenseActivation) {
    const providerReturn = licenseProviderReturn({ deliveryFields, credential });
    return <section className="delivery credential-delivery" aria-label="Entrega digital">
      <b>{LICENSE_DELIVERY_TITLE}</b>
      <p>{title ?? "Licença UnlockTool"}</p>
      <p>{LICENSE_DELIVERY_TEXT}</p>
      {providerReturn && <small>Retorno do fornecedor: {providerReturn}</small>}
      <CustomerFields fields={customerFields} />
    </section>;
  }
  return <section className="delivery credential-delivery" aria-label="Entrega digital">
    <b>{deliveryHeading(deliveryType)}</b>
    <p>{title ?? "Entrega digital"}</p>
    <CustomerFields fields={customerFields} />
    {fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.value}</strong><button type="button" onClick={() => copy(field.key, field.value)}>{copied === field.key ? "Copiado" : "Copiar"}</button></div>)}
    {instructions && <small>{instructions}</small>}
  </section>;
}
