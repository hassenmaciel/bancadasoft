"use client";

import { useEffect, useRef, useState } from "react";

type Props = { username?: string; password?: string; instructions?: string };

export default function CredentialDelivery({ username, password, instructions }: Props) {
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy(kind: "username" | "password", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  }
  return <section className="delivery credential-delivery" aria-label="Credenciais de acesso">
    <b>Acesso liberado</b>
    <p>UnlockTool — Aluguel 6 horas</p>
    {username && <div><span>Usuário/Login</span><strong>{username}</strong><button type="button" onClick={() => copy("username", username)}>{copied === "username" ? "Copiado" : "Copiar usuário"}</button></div>}
    {password && <div><span>Senha</span><strong>{password}</strong><button type="button" onClick={() => copy("password", password)}>{copied === "password" ? "Copiada" : "Copiar senha"}</button></div>}
    {instructions && <small>{instructions}</small>}
  </section>;
}
