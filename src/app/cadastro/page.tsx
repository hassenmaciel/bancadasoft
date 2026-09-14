"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/public-navigation";
import styles from "../login/login.module.css";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setDuplicateEmail(false);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          whatsapp: form.get("whatsapp"),
          cpfCnpj: form.get("cpfCnpj"),
          password: form.get("password"),
          passwordConfirmation: form.get("passwordConfirmation"),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setDuplicateEmail(response.status === 409);
        setError(body.error ?? "Não foi possível criar sua conta.");
        return;
      }

      router.push(
        safeNextPath(new URLSearchParams(window.location.search).get("next")),
      );
      router.refresh();
    } catch {
      setError("Não foi possível criar sua conta agora.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.glow} />
      <section className={`${styles.card} ${styles.registerCard}`}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            BANCADA<span>SOFT</span>
          </Link>
          <span className={styles.badge}>CADASTRO SEGURO</span>
        </header>
        <div className={styles.intro}>
          <small>ÁREA DO CLIENTE</small>
          <h1>Crie sua conta</h1>
          <p>Consulte preços exclusivos e acompanhe seus pedidos.</p>
        </div>
        <form onSubmit={submit} className={styles.form}>
          <label>
            Nome completo
            <input name="name" autoComplete="name" required minLength={2} />
          </label>
          <label>
            E-mail
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <div className={styles.fieldGrid}>
            <label>
              WhatsApp
              <input
                name="whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 99999-9999"
                required
              />
            </label>
            <label>
              CPF
              <input
                name="cpfCnpj"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                required
              />
            </label>
          </div>
          <label>
            Senha
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
            <small className={styles.helper}>
              Use 12+ caracteres, maiúscula, minúscula, número e símbolo.
            </small>
          </label>
          <label>
            Confirmar senha
            <input
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
              {duplicateEmail && (
                <Link className={styles.errorLink} href="/login">
                  Fazer login
                </Link>
              )}
            </p>
          )}
          <button disabled={loading} type="submit">
            {loading ? "Criando..." : "Criar minha conta"}
          </button>
        </form>
        <footer className={styles.accountPrompt}>
          Já possui cadastro? <Link href="/login">Entrar na minha conta</Link>
        </footer>
      </section>
      <p className={styles.back}>
        <Link href="/">← Voltar ao site</Link>
      </p>
    </main>
  );
}
