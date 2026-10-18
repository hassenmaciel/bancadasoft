import { AccountLedgerEntryType, OrderStatus, PaymentStatus, ProductType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REFUND_REFERENCE_PREFIX } from "@/lib/account-balance";
import { parseResellerNote } from "@/lib/reseller-api";

// Admin > Estatísticas (somente leitura). As agregações são funções puras
// sobre o que o Prisma devolve, para serem testadas sem banco.

export const STATS_PERIODS = ["7", "30", "90", "all"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export const STATS_PERIOD_LABELS: Record<StatsPeriod, string> = { "7": "7 dias", "30": "30 dias", "90": "90 dias", all: "Tudo" };

// Pedidos que contam como venda: pagos ou entregues. CANCELLED, FAILED e
// PENDING_PAYMENT ficam de fora.
export const COUNTED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.FULFILLED,
  OrderStatus.DELIVERED,
];

// Pedido de teste = pago pelo provider de pagamento simulado (payments/mock.ts).
export const TEST_PAYMENT_PROVIDER = "mock";

// Agrupa no ranking de produtos as vendas da API cujo produto não foi identificado.
export const RESELLER_UNKNOWN_PRODUCT_ID = "reseller-api";
export const RESELLER_UNKNOWN_PRODUCT_NAME = "Venda via API de revenda";

export function parseStatsPeriod(raw: string | string[] | undefined): StatsPeriod {
  return typeof raw === "string" && (STATS_PERIODS as readonly string[]).includes(raw) ? (raw as StatsPeriod) : "30";
}

export function periodStart(period: StatsPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - Number(period) * 24 * 60 * 60 * 1000);
}

const notTestOrder: Prisma.OrderWhereInput = { NOT: { payment: { is: { provider: TEST_PAYMENT_PROVIDER } } } };
// O webhook PAYMENT_REFUNDED muda só Payment.status; Order.status continua
// PAID/DELIVERED. Por isso o reembolso é filtrado pelo pagamento.
const notRefundedOrder: Prisma.OrderWhereInput = { NOT: { payment: { is: { status: PaymentStatus.REFUNDED } } } };
// Recarga de saldo fica fora do faturamento: o valor volta a ser contado
// quando o cliente compra com o saldo (senão seria contado duas vezes).
const notTopupOrder: Prisma.OrderWhereInput = { items: { none: { product: { type: ProductType.BALANCE_TOPUP } } } };

export function buildStatsOrderWhere(start: Date | null): Prisma.OrderWhereInput {
  const clauses: Prisma.OrderWhereInput[] = [{ status: { in: COUNTED_ORDER_STATUSES } }, notTestOrder, notRefundedOrder, notTopupOrder];
  if (start) clauses.push({ createdAt: { gte: start } });
  return { AND: clauses };
}

// Mesmo recorte, sem filtrar por status: usado no quadro "pedidos por status".
export function buildStatusBreakdownWhere(start: Date | null): Prisma.OrderWhereInput {
  const clauses: Prisma.OrderWhereInput[] = [{ status: { not: OrderStatus.CANCELLED } }, notTestOrder, notRefundedOrder, notTopupOrder];
  if (start) clauses.push({ createdAt: { gte: start } });
  return { AND: clauses };
}

export function buildTopupOrderWhere(start: Date | null): Prisma.OrderWhereInput {
  const clauses: Prisma.OrderWhereInput[] = [
    { status: { in: COUNTED_ORDER_STATUSES } },
    notTestOrder,
    notRefundedOrder,
    { items: { some: { product: { type: ProductType.BALANCE_TOPUP } } } },
  ];
  if (start) clauses.push({ createdAt: { gte: start } });
  return { AND: clauses };
}

// Versão em memória de buildStatsOrderWhere, para o histórico do cliente
// marcar quais pedidos entram nas estatísticas (os testes cobrem as duas).
export function orderCountsAsSale(order: {
  status: OrderStatus;
  payment: { provider: string; status: PaymentStatus } | null;
  items: Array<{ product: { type: ProductType } }>;
}) {
  return (
    COUNTED_ORDER_STATUSES.includes(order.status) &&
    order.payment?.provider !== TEST_PAYMENT_PROVIDER &&
    order.payment?.status !== PaymentStatus.REFUNDED &&
    !order.items.some((item) => item.product.type === ProductType.BALANCE_TOPUP)
  );
}

// Venda da API de revenda = lançamento PURCHASE criado por debitPurchase:
// tem externalReference e nunca sourceOrderId. A compra da loja com saldo
// (debitOrderPurchase) é o contrário — sourceOrderId e sem externalReference —
// e já é contada pela Order, então os dois conjuntos não se sobrepõem.
export function buildResellerPurchaseWhere(start: Date | null, userId?: string): Prisma.AccountLedgerEntryWhereInput {
  return {
    type: AccountLedgerEntryType.PURCHASE,
    sourceOrderId: null,
    externalReference: { not: null },
    ...(userId ? { userId } : {}),
    ...(start ? { createdAt: { gte: start } } : {}),
  };
}

export type ResellerPurchaseEntry = { id: string; userId: string; amountCents: number; externalReference: string | null; note: string | null; createdAt: Date };
export type ResellerRefundEntry = { userId: string; externalReference: string | null };
export type ResellerProductLink = { externalProductId: string; provider: { code: string }; product: { id: string; name: string } | null };
export type ResellerSale = {
  entryId: string;
  userId: string;
  amountCents: number;
  externalReference: string;
  createdAt: Date;
  refunded: boolean;
  productId: string;
  productName: string;
};

const refundKey = (userId: string, externalReference: string) => `${userId}\n${externalReference}`;
const linkKey = (providerCode: string, externalProductId: string) => `${providerCode}\n${externalProductId}`;

export function refundReferencesFor(purchases: ResellerPurchaseEntry[]) {
  return purchases.flatMap((entry) => (entry.externalReference ? [`${REFUND_REFERENCE_PREFIX}${entry.externalReference}`] : []));
}

// Produto: o note do PURCHASE ("Revenda <provider> <externalProductId>") é
// lido por parseResellerNote (a mesma regra do replay da API) e casado com
// ProviderProduct (providerId + externalProductId) -> Product.
export function resellerProductKeys(purchases: ResellerPurchaseEntry[]) {
  const keys = new Map(purchases.map((entry) => {
    const { providerCode, externalProductId } = parseResellerNote(entry.note);
    return [linkKey(providerCode, externalProductId), { providerCode, externalProductId }] as const;
  }));
  return [...keys.values()];
}

export function buildResellerSales(
  purchases: ResellerPurchaseEntry[],
  refunds: ResellerRefundEntry[],
  links: ResellerProductLink[],
): ResellerSale[] {
  // refundPurchase grava "refund:<externalReference da compra>" para o mesmo userId.
  const refunded = new Set(
    refunds.flatMap((entry) =>
      entry.externalReference?.startsWith(REFUND_REFERENCE_PREFIX)
        ? [refundKey(entry.userId, entry.externalReference.slice(REFUND_REFERENCE_PREFIX.length))]
        : [],
    ),
  );
  const products = new Map(links.map((link) => [linkKey(link.provider.code, link.externalProductId), link.product]));
  return purchases.flatMap((entry) => {
    if (!entry.externalReference) return [];
    const bought = parseResellerNote(entry.note);
    const product = products.get(linkKey(bought.providerCode, bought.externalProductId)) ?? null;
    return [{
      entryId: entry.id,
      userId: entry.userId,
      amountCents: Math.abs(entry.amountCents),
      externalReference: entry.externalReference,
      createdAt: entry.createdAt,
      refunded: refunded.has(refundKey(entry.userId, entry.externalReference)),
      productId: product?.id ?? RESELLER_UNKNOWN_PRODUCT_ID,
      productName: product?.name ?? RESELLER_UNKNOWN_PRODUCT_NAME,
    }];
  });
}

async function loadResellerSales(where: Prisma.AccountLedgerEntryWhereInput) {
  const purchases = await prisma.accountLedgerEntry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, amountCents: true, externalReference: true, note: true, createdAt: true },
  });
  if (!purchases.length) return [];
  const keys = resellerProductKeys(purchases);
  const [refunds, links] = await Promise.all([
    prisma.accountLedgerEntry.findMany({
      where: { type: AccountLedgerEntryType.REFUND, externalReference: { in: refundReferencesFor(purchases) } },
      select: { userId: true, externalReference: true },
    }),
    prisma.providerProduct.findMany({
      where: { OR: keys.map((key) => ({ externalProductId: key.externalProductId, provider: { code: key.providerCode } })) },
      select: { externalProductId: true, provider: { select: { code: true } }, product: { select: { id: true, name: true } } },
    }),
  ]);
  return buildResellerSales(purchases, refunds, links);
}

export type CustomerGroup = { customerId: string; _sum: { totalCents: number | null }; _count: { _all: number } };
export type CustomerRankRow = { customerId: string; name: string; email: string; totalCents: number; orderCount: number };

// Soma as vendas da API (já sem estornadas) aos grupos de pedidos da loja.
export function mergeResellerIntoCustomerGroups(groups: CustomerGroup[], sales: ResellerSale[]): CustomerGroup[] {
  const merged = new Map(groups.map((group) => [group.customerId, { customerId: group.customerId, _sum: { totalCents: group._sum.totalCents ?? 0 }, _count: { _all: group._count._all } }]));
  for (const sale of sales) {
    if (sale.refunded) continue;
    const row = merged.get(sale.userId) ?? { customerId: sale.userId, _sum: { totalCents: 0 }, _count: { _all: 0 } };
    row._sum.totalCents += sale.amountCents;
    row._count._all += 1;
    merged.set(sale.userId, row);
  }
  return [...merged.values()];
}

export function rankCustomers(
  groups: CustomerGroup[],
  users: Array<{ id: string; name: string; email: string }>,
  by: "value" | "count",
  limit = 10,
): CustomerRankRow[] {
  const byId = new Map(users.map((user) => [user.id, user]));
  const rows = groups.map((group) => ({
    customerId: group.customerId,
    name: byId.get(group.customerId)?.name ?? "—",
    email: byId.get(group.customerId)?.email ?? "",
    totalCents: group._sum.totalCents ?? 0,
    orderCount: group._count._all,
  }));
  const primary = (row: CustomerRankRow) => (by === "value" ? row.totalCents : row.orderCount);
  const secondary = (row: CustomerRankRow) => (by === "value" ? row.orderCount : row.totalCents);
  return rows.sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

export type SoldItem = { productId: string; quantity: number; unitPriceCents: number; product: { name: string } };
export type ProductRankRow = { productId: string; name: string; quantity: number; totalCents: number; orderCount: number };

export function resellerSoldItems(sales: ResellerSale[]): SoldItem[] {
  return sales
    .filter((sale) => !sale.refunded)
    .map((sale) => ({ productId: sale.productId, quantity: 1, unitPriceCents: sale.amountCents, product: { name: sale.productName } }));
}

export function rankProducts(items: SoldItem[], by: "value" | "quantity", limit = 10): ProductRankRow[] {
  const rows = new Map<string, ProductRankRow>();
  for (const item of items) {
    const row = rows.get(item.productId) ?? { productId: item.productId, name: item.product.name, quantity: 0, totalCents: 0, orderCount: 0 };
    row.quantity += item.quantity;
    row.totalCents += item.unitPriceCents * item.quantity;
    row.orderCount += 1;
    rows.set(item.productId, row);
  }
  const primary = (row: ProductRankRow) => (by === "value" ? row.totalCents : row.quantity);
  const secondary = (row: ProductRankRow) => (by === "value" ? row.quantity : row.totalCents);
  return [...rows.values()].sort((a, b) => primary(b) - primary(a) || secondary(b) - secondary(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

export function summarizeTotals(aggregate: { _count: { _all: number }; _sum: { totalCents: number | null } }) {
  const paidOrders = aggregate._count._all;
  const revenueCents = aggregate._sum.totalCents ?? 0;
  return { paidOrders, revenueCents, averageTicketCents: paidOrders ? Math.round(revenueCents / paidOrders) : 0 };
}

export function summarizeResellerSales(sales: ResellerSale[]) {
  const active = sales.filter((sale) => !sale.refunded);
  return summarizeTotals({ _count: { _all: active.length }, _sum: { totalCents: active.reduce((sum, sale) => sum + sale.amountCents, 0) } });
}

export function combineTotals(store: ReturnType<typeof summarizeTotals>, reseller: ReturnType<typeof summarizeTotals>) {
  return summarizeTotals({ _count: { _all: store.paidOrders + reseller.paidOrders }, _sum: { totalCents: store.revenueCents + reseller.revenueCents } });
}

export function statusBreakdown(groups: Array<{ status: OrderStatus; _count: { _all: number } }>) {
  return Object.values(OrderStatus)
    .filter((status) => status !== OrderStatus.CANCELLED)
    .map((status) => ({ status, count: groups.find((group) => group.status === status)?._count._all ?? 0 }));
}

// Forma de pagamento a partir de Payment.provider (commerce.ts grava "balance"
// no pagamento por saldo; PIX usa o provider configurado, ex.: "asaas").
export function paymentMethodLabel(provider: string | null | undefined) {
  if (!provider) return "—";
  if (provider === "balance") return "Saldo";
  if (provider === TEST_PAYMENT_PROVIDER) return "PIX (teste)";
  return "PIX";
}

export async function getAdminStatistics(period: StatsPeriod, now = new Date()) {
  const start = periodStart(period, now);
  const where = buildStatsOrderWhere(start);
  const [totals, statusGroups, customerGroups, items, topups, resellerSales] = await Promise.all([
    prisma.order.aggregate({ where, _count: { _all: true }, _sum: { totalCents: true } }),
    prisma.order.groupBy({ by: ["status"], where: buildStatusBreakdownWhere(start), _count: { _all: true } }),
    prisma.order.groupBy({ by: ["customerId"], where, _count: { _all: true }, _sum: { totalCents: true } }),
    prisma.orderItem.findMany({ where: { order: where }, select: { productId: true, quantity: true, unitPriceCents: true, product: { select: { name: true } } } }),
    prisma.order.aggregate({ where: buildTopupOrderWhere(start), _count: { _all: true }, _sum: { totalCents: true } }),
    loadResellerSales(buildResellerPurchaseWhere(start)),
  ]);
  const groups = mergeResellerIntoCustomerGroups(customerGroups as CustomerGroup[], resellerSales);
  const soldItems = [...items, ...resellerSoldItems(resellerSales)];
  const ids = [...new Set([...rankCustomers(groups, [], "value"), ...rankCustomers(groups, [], "count")].map((row) => row.customerId))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const store = summarizeTotals(totals);
  const reseller = summarizeResellerSales(resellerSales);
  return {
    period,
    store,
    reseller,
    totals: combineTotals(store, reseller),
    topups: summarizeTotals(topups),
    statuses: statusBreakdown(statusGroups as Array<{ status: OrderStatus; _count: { _all: number } }>),
    customersByValue: rankCustomers(groups, users, "value"),
    customersByCount: rankCustomers(groups, users, "count"),
    productsByQuantity: rankProducts(soldItems, "quantity"),
    productsByValue: rankProducts(soldItems, "value"),
  };
}

export type BalanceSort = "desc" | "asc";
export function parseBalanceSort(raw: string | string[] | undefined): BalanceSort {
  return raw === "asc" ? "asc" : "desc";
}

export async function getCustomerBalances(sort: BalanceSort, limit = 200) {
  return prisma.accountBalance.findMany({
    orderBy: [{ balanceCents: sort }, { updatedAt: "desc" }],
    take: limit,
    select: { userId: true, balanceCents: true, enabled: true, updatedAt: true, user: { select: { name: true, email: true, customerTier: true } } },
  });
}

export async function getCustomerHistory(userId: string) {
  const [user, resellerSales] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, customerTier: true, active: true, createdAt: true,
        accountBalance: { select: { balanceCents: true, enabled: true } },
        orders: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true, publicToken: true, status: true, totalCents: true, createdAt: true,
            payment: { select: { provider: true, status: true } },
            items: { select: { quantity: true, unitPriceCents: true, product: { select: { name: true, type: true } }, productVariant: { select: { name: true } } } },
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, amountCents: true, balanceAfterCents: true, sourceOrderId: true, note: true, createdAt: true },
        },
      },
    }),
    loadResellerSales(buildResellerPurchaseWhere(null, userId)),
  ]);
  if (!user) return null;
  const orders = user.orders.map((order) => ({ ...order, countsAsSale: orderCountsAsSale(order) }));
  const countedCents =
    orders.reduce((sum, order) => sum + (order.countsAsSale ? order.totalCents : 0), 0) +
    summarizeResellerSales(resellerSales).revenueCents;
  return { ...user, orders, resellerSales, countedCents };
}
