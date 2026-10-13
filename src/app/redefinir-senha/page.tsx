"use client";

import Link from "next/link";
import { FormEvent, useState, useSyncExternalStore } from "react";
import styles from "../login/login.module.css";

// O token chega no fragmento (#token=...), que o navegador não envia ao servidor.
// null = ainda no servidor/hidratação; "" = link sem token.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHashToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";

export default function ResetPassword() {
  const token = useSyncExternalStore(subscribeHash, readHashToken, () => null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          password: form.get("password"),
          passwordConfirmation: form.get("passwordConfirmation"),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Não foi possível redefinir a senha.");
        return;
      }
      setDone(body.data.message);
      // Token já consumido: tira do endereço/histórico (sem disparar hashchange).
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      setError("Não foi possível redefinir a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.glow} />
      <section className={styles.card}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            BANCADA<span>SOFT</span>
          </Link>
          <span className={styles.badge}>ACESSO SEGURO</span>
        </header>
        <div className={styles.intro}>
          <small>RECUPERAR ACESSO</small>
          <h1>Defina uma nova senha</h1>
          <p>Ao salvar, as sessões abertas em outros aparelhos serão encerradas.</p>
        </div>
        {done ? (
          <div className={styles.form}>
            <p className={styles.success} role="status">{done}</p>
            <Link href="/login" className={styles.secondaryAction}>Ir para o login</Link>
          </div>
        ) : token === "" ? (
          <p className={styles.error} role="alert">
            Link incompleto. Abra o link exatamente como recebido no e-mail ou{" "}
            <Link href="/esqueci-senha" className={styles.errorLink}>peça um novo link</Link>.
          </p>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label>
              Nova senha
              <input name="password" type="password" autoComplete="new-password" minLength={12} required />
              <span className={styles.helper}>12+ caracteres, com maiúscula, minúscula, número e símbolo.</span>
            </label>
            <label>
              Confirme a nova senha
              <input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={12} required />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}{" "}
                {error.startsWith("Link") && (
                  <Link href="/esqueci-senha" className={styles.errorLink}>Pedir novo link</Link>
                )}
              </p>
            )}
            <button disabled={loading || token === null} type="submit">
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
        <footer className={styles.accountPrompt}>
          <Link href="/login">Voltar para o login</Link>
        </footer>
      </section>
    </main>
  );
}
