"use client";

import { useEffect, useRef, useState } from "react";

type DeliveryField = { key: string; label: string; value: string; sensitive: boolean };
type Props = { title?: string; username?: string; password?: string; credential?: string; instructions?: string; deliveryFields?: DeliveryField[] };

export default function CredentialDelivery({ title, username, password, credential, instructions, deliveryFields }: Props) {
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
    ...(credential ? [{ key: "credential", label: "Código/Licença", value: credential, sensitive: true }] : []),
  ];
  return <section className="delivery credential-delivery" aria-label="Entrega digital">
    <b>Acesso liberado</b>
    <p>{title ?? "Entrega digital"}</p>
    {fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.value}</strong><button type="button" onClick={() => copy(field.key, field.value)}>{copied === field.key ? "Copiado" : "Copiar"}</button></div>)}
    {instructions && <small>{instructions}</small>}
  </section>;
}
