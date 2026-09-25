import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import UserManager from "./user-manager";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin();
  const { q } = await searchParams;
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : undefined,
    select: { id: true, name: true, email: true, role: true, customerTier: true, active: true, createdAt: true, _count: { select: { orders: true } }, accountBalance: { select: { enabled: true, balanceCents: true } }, resellerApiKeys: { select: { id: true, label: true, active: true, revokedAt: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } } },
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  return <><header className="admin-heading"><div><small>ACESSOS</small><h1>Usuários</h1><p>Criação, função, nível comercial e preservação de histórico.</p></div></header><form className="admin-filters"><input name="q" defaultValue={q} placeholder="Buscar nome ou e-mail"/><button className="admin-primary">Buscar</button></form><UserManager currentAdminId={admin.id} rows={users.map(user => ({ id: user.id, name: user.name, email: user.email, role: user.role, customerTier: user.customerTier, active: user.active, createdAt: user.createdAt.toISOString(), orderCount: user._count.orders, balance: user.accountBalance, resellerKeys: user.resellerApiKeys.map(key => ({ id: key.id, label: key.label, active: key.active, revokedAt: key.revokedAt?.toISOString() ?? null, lastUsedAt: key.lastUsedAt?.toISOString() ?? null, createdAt: key.createdAt.toISOString() })) }))}/></>;
}
