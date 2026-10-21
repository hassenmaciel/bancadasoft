import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { buildAdminUserWhere, parseAdminUserSearch } from "@/lib/admin-user-search";
import UserManager from "./user-manager";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdmin();
  const filters = parseAdminUserSearch(await searchParams);
  const users = await prisma.user.findMany({
    where: buildAdminUserWhere(filters),
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customerTier: true,
      canUseBalanceAsPayment: true,
      balanceTopupBlocked: true,
      active: true,
      createdAt: true,
      _count: { select: { orders: true } },
      accountBalance: { select: { enabled: true, balanceCents: true } },
      resellerApiKeys: {
        select: { id: true, label: true, active: true, revokedAt: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
    take: 100,
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <header className="admin-heading">
        <div>
          <small>ACESSOS</small>
          <h1>Usuários</h1>
          <p>Criação, função, nível comercial e preservação de histórico.</p>
        </div>
      </header>
      <form className="admin-filters user-filters">
        <input name="q" defaultValue={filters.q} placeholder="Buscar nome ou e-mail" />
        <select name="tier" defaultValue={filters.tier ?? ""} aria-label="Tier">
          <option value="">Todos os tiers</option>
          <option value="NORMAL">NORMAL</option>
          <option value="PREMIUM">PREMIUM</option>
          <option value="PREMIUM_PLUS">PREMIUM_PLUS</option>
        </select>
        <select name="balance" defaultValue={filters.balance ?? ""} aria-label="Saldo">
          <option value="">Qualquer saldo</option>
          <option value="positive">Saldo maior que zero</option>
        </select>
        <select name="orders" defaultValue={filters.orders ?? ""} aria-label="Pedidos">
          <option value="">Com ou sem pedidos</option>
          <option value="none">Sem pedidos</option>
        </select>
        <select name="status" defaultValue={filters.status ?? ""} aria-label="Status">
          <option value="">Ativos e inativos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
        <button className="admin-primary">Filtrar</button>
      </form>
      <UserManager
        currentAdminId={admin.id}
        rows={users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          customerTier: user.customerTier,
          canUseBalanceAsPayment: user.canUseBalanceAsPayment,
          balanceTopupBlocked: user.balanceTopupBlocked,
          active: user.active,
          createdAt: user.createdAt.toISOString(),
          orderCount: user._count.orders,
          balance: user.accountBalance,
          resellerKeys: user.resellerApiKeys.map((key) => ({
            id: key.id,
            label: key.label,
            active: key.active,
            revokedAt: key.revokedAt?.toISOString() ?? null,
            lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
            createdAt: key.createdAt.toISOString(),
          })),
        }))}
      />
    </>
  );
}