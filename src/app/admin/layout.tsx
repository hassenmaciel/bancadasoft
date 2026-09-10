import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import "./admin.css";
import "./orders.css";
import "./integrations.css";
import "./integration-fixes.css";
import "./payments.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try { admin = await requireAdmin(); } catch { redirect("/login?next=/admin"); }
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <Link className="admin-brand" href="/admin">BANCADA<span>SOFT</span><small>Administração</small></Link>
      <nav><Link href="/admin/pedidos">Pedidos</Link><Link href="/admin/produtos">Produtos</Link><Link href="/admin/categorias">Categorias</Link><Link href="/admin/integracoes">Integrações</Link></nav>
      <div className="admin-user"><b>{admin.name}</b><small>{admin.email}</small><Link href="/">Ver loja</Link></div>
    </aside>
    <main className="admin-content">{children}</main>
  </div>;
}
