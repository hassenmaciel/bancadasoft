import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import CustomerBalancePanel from "@/components/customer-balance-panel";
import { publicViewer } from "@/lib/public-viewer";
import { requireUser } from "@/lib/auth";
import { loadCustomerBalance } from "@/lib/customer-balance";

export const metadata: Metadata = { title: "Meu saldo | BancadaSoft", robots: { index: false, follow: false } };

export default async function BalancePage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/minha-conta/saldo");
  }
  const view = await loadCustomerBalance(user);
  return (
    <main>
      <PublicHeader viewer={publicViewer(user)} />
      <section className="customer-page wrap">
        <nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><b>Meu saldo</b></nav>
        <header>
          <span className="eyebrow dark">Sua conta</span>
          <h1>Meu saldo</h1>
          <p>Consulte seu saldo, o extrato e recarregue.</p>
        </header>
        <CustomerBalancePanel view={view} />
      </section>
      <PublicFooter />
    </main>
  );
}
