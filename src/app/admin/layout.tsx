import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import AdminNav from "./admin-nav";
import "./admin.css";import "./orders.css";import "./integrations.css";import "./integration-fixes.css";import "./payments.css";
export const metadata={robots:{index:false,follow:false}};
export const dynamic="force-dynamic";
export default async function AdminLayout({children}:{children:React.ReactNode}){let admin;try{admin=await requireAdmin()}catch{redirect("/login?next=/admin")}return <div className="admin-shell"><aside className="admin-sidebar"><div className="admin-sidebar-head"><Link className="admin-brand" href="/admin">BANCADA<span>SOFT</span><small>Central de operação</small></Link><span className="admin-env">ADMIN</span></div><AdminNav/><div className="admin-user"><span className="admin-avatar">{admin.name.slice(0,1).toUpperCase()}</span><div><b>{admin.name}</b><small>{admin.email}</small><Link href="/">Abrir loja pública ↗</Link></div></div></aside><main className="admin-content">{children}</main></div>}
