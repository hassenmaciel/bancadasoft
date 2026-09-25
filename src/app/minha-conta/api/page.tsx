import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import ResellerApiDocs from "@/components/reseller-api-docs";
import { publicViewer } from "@/lib/public-viewer";
import { requireUser } from "@/lib/auth";
import { isResellerRole } from "@/lib/authorization";

export const metadata: Metadata = { title: "API de revenda | BancadaSoft", robots: { index: false, follow: false } };

// Sem sessão -> login (mesmo padrão de /minha-conta/saldo). Logado sem papel
// RESELLER -> /minha-conta/saldo: o projeto restringe páginas por papel com
// redirect (ver admin/layout.tsx), e notFound() fica reservado a recurso
// inexistente ou de outro dono. A documentação não é segredo; a chave é.
export default async function ResellerApiPage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login?next=/minha-conta/api");
  }
  if (!isResellerRole(user.role)) redirect("/minha-conta/saldo");
  return (
    <main>
      <PublicHeader viewer={publicViewer(user)} />
      <section className="customer-page wrap">
        <nav className="breadcrumbs"><Link href="/">Início</Link><span>›</span><b>API de revenda</b></nav>
        <header>
          <span className="eyebrow dark">Sua conta</span>
          <h1>API de revenda</h1>
          <p>Como integrar seu sistema para comprar tickets usando o saldo pré-pago.</p>
        </header>
        <ResellerApiDocs />
      </section>
      <PublicFooter />
    </main>
  );
}
