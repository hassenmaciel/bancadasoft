"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { SUPPORT_WHATSAPP_URL } from "@/lib/support";
import type { PublicViewer } from "@/lib/public-viewer";

export default function PublicHeader({ viewer, initialQuery = "" }: { viewer: PublicViewer; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [signedOut, setSignedOut] = useState(false);
  const user = signedOut ? null : viewer;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/catalogo?q=${encodeURIComponent(value)}` : "/catalogo");
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSignedOut(true);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="wrap header-main">
        <Link className="brand" href="/" aria-label="BancadaSoft - início">
          BANCADA<span>SOFT</span><small>Ferramentas e serviços para técnicos</small>
        </Link>
        <form className="search" onSubmit={search} role="search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="O que você procura? Ex.: UnlockTool, Samsung, FRP..." aria-label="Pesquisar produtos" />
          <button type="submit" aria-label="Buscar">⌕</button>
        </form>
        <div className="account">
          {user ? <><Link href="/meus-pedidos">Olá, {user.name.split(" ")[0]}</Link><button type="button" onClick={signOut}>Sair</button></> : <Link href="/login">Entrar</Link>}
          <Link href="/meus-pedidos">Meus pedidos</Link>
          {user?.role === "ADMIN" && <Link href="/admin">Painel Admin</Link>}
          <a className="support-link" href={SUPPORT_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">◉ Suporte</a>
        </div>
      </div>
      <nav className="nav-bar" aria-label="Navegação principal">
        <div className="wrap nav-inner">
          <Link href="/">⌂ Início</Link>
          <Link href="/catalogo?tipo=ferramentas">⚙ Ferramentas</Link>
          <Link href="/catalogo?tipo=aluguel">▣ Aluguéis</Link>
          <Link href="/catalogo?tipo=licenca">▤ Licenças</Link>
          <Link href="/catalogo?tipo=servico">⌘ Serviços</Link>
          <Link href="/catalogo?tipo=credito">▰ Créditos</Link>
          <Link href="/catalogo?ordem=populares">★ Mais vendidos</Link>
        </div>
      </nav>
    </header>
  );
}
