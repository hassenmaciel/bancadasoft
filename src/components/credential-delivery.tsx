"use client";

import { useEffect, useRef, useState } from "react";
import { deliveryHeading } from "@/lib/customer-delivery";
import type { DeliveryDTO } from "@/lib/dto";
import { LICENSE_DELIVERY_TEXT, LICENSE_DELIVERY_TITLE, licenseProviderReturn } from "@/lib/unlocktool-license";

type DeliveryField = { key: string; label: string; value: string; sensitive: boolean };
// licenseActivation só é true para a licença UnlockTool (ver isUnlockToolLicense):
// o retorno do fornecedor é apenas uma confirmação, não uma credencial.
type Props = DeliveryDTO & { licenseActivation?: boolean };

export default function CredentialDelivery({ deliveryType, title, username, password, credential, instructions, deliveryFields, licenseActivation }: Props) {
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
    </section>;
  }
  return <section className="delivery credential-delivery" aria-label="Entrega digital">
    <b>{deliveryHeading(deliveryType)}</b>
    <p>{title ?? "Entrega digital"}</p>
    {fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.value}</strong><button type="button" onClick={() => copy(field.key, field.value)}>{copied === field.key ? "Copiado" : "Copiar"}</button></div>)}
    {instructions && <small>{instructions}</small>}
  </section>;
}
