import Link from "next/link";
import { prisma } from "@/lib/prisma";
import ProductForm from "../product-form";
export const dynamic = "force-dynamic";
export default async function NewProductPage() { const categories = await prisma.category.findMany({ orderBy: { name: "asc" } }); return <><header className="admin-heading"><div><Link href="/admin/produtos">← Produtos</Link><h1>Novo produto</h1><p>Cadastre um item e controle sua publicação.</p></div></header><ProductForm categories={categories.map(({id,name}) => ({id,name}))} /></>; }
