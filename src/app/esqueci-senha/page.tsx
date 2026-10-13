"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "../login/login.module.css";

export default function ForgotPassword() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Não foi possível enviar agora.");
        return;
      }
      setSent(body.data.message);
    } catch {
      setError("Não foi possível enviar agora.");
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
          <h1>Esqueci minha senha</h1>
          <p>Informe o e-mail da sua conta. Enviaremos um link para definir uma nova senha.</p>
        </div>
        {sent ? (
          <p className={styles.success} role="status">
            {sent} Confira também a caixa de spam. O link vale por 1 hora.
          </p>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <label>
              E-mail
              <input name="email" type="email" autoComplete="email" placeholder="seu@email.com" required />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button disabled={loading} type="submit">
              {loading ? "Enviando..." : "Enviar link de redefinição"}
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
