import { CustomerTier, type Prisma } from "@prisma/client";

export type AdminUserSearchFilters = {
  q?: string;
  tier?: string;
  // "positive" = saldo maior que zero.
  balance?: string;
  // "none" = sem nenhum pedido.
  orders?: string;
  // "active" | "inactive".
  status?: string;
};

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export function parseAdminUserSearch(params: Record<string, string | string[] | undefined>): AdminUserSearchFilters {
  return { q: single(params.q), tier: single(params.tier), balance: single(params.balance), orders: single(params.orders), status: single(params.status) };
}

/** Filtro combinável do Admin > Usuários; valores desconhecidos são ignorados. */
export function buildAdminUserWhere(filters: AdminUserSearchFilters): Prisma.UserWhereInput {
  const clauses: Prisma.UserWhereInput[] = [];
  const term = filters.q?.trim();
  if (term)
    clauses.push({ OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }] });
  if (filters.tier && (Object.values(CustomerTier) as string[]).includes(filters.tier))
    clauses.push({ customerTier: filters.tier as CustomerTier });
  if (filters.balance === "positive") clauses.push({ accountBalance: { is: { balanceCents: { gt: 0 } } } });
  if (filters.orders === "none") clauses.push({ orders: { none: {} } });
  if (filters.status === "active") clauses.push({ active: true });
  if (filters.status === "inactive") clauses.push({ active: false });
  return clauses.length ? { AND: clauses } : {};
}
