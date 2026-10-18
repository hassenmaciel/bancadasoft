import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import {
  RESELLER_UNKNOWN_PRODUCT_ID,
  STATS_PERIODS,
  STATS_PERIOD_LABELS,
  getAdminStatistics,
  getCustomerBalances,
  parseBalanceSort,
  parseStatsPeriod,
  type CustomerRankRow,
  type ProductRankRow,
} from "@/lib/admin-statistics";

export const dynamic = "force-dynamic";
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const customerHref = (id: string) => `/admin/estatisticas/clientes/${id}`;

function CustomerTable({ title, rows }: { title: string; rows: CustomerRankRow[] }) {
  return (
    <section className="admin-section">
      <div className="section-title"><h2>{title}</h2></div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>#</th><th>Cliente</th><th>Pedidos</th><th>Valor pago</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.customerId}>
                <td>{index + 1}</td>
                <td><Link href={customerHref(row.customerId)}>{row.name}</Link><small className="cell-subtitle">{row.email}</small></td>
                <td>{row.orderCount}</td>
                <td>{money(row.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="admin-empty">Nenhum pedido pago no período.</p>}
      </div>
    </section>
  );
}

function ProductTable({ title, rows }: { title: string; rows: ProductRankRow[] }) {
  return (
    <section className="admin-section">
      <div className="section-title"><h2>{title}</h2></div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>#</th><th>Produto</th><th>Quantidade</th><th>Valor</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.productId}>
                <td>{index + 1}</td>
                <td>{row.productId === RESELLER_UNKNOWN_PRODUCT_ID ? row.name : <Link href={`/admin/produtos/${row.productId}`}>{row.name}</Link>}</td>
                <td>{row.quantity}</td>
                <td>{money(row.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="admin-empty">Nenhuma venda no período.</p>}
      </div>
    </section>
  );
}

export default async function StatisticsPage({ searchParams }: { searchParams: Promise<{ periodo?: string | string[]; saldo?: string | string[] }> }) {
  await requireAdmin();
  const params = await searchParams;
  const period = parseStatsPeriod(params.periodo);
  const balanceSort = parseBalanceSort(params.saldo);
  const [stats, balances] = await Promise.all([getAdminStatistics(period), getCustomerBalances(balanceSort)]);
  const query = (next: { periodo?: string; saldo?: string }) =>
    `?${new URLSearchParams({ periodo: next.periodo ?? period, saldo: next.saldo ?? balanceSort })}`;
  const cards: Array<[string, string | number, string?]> = [
    ["Faturamento bruto", money(stats.totals.revenueCents), "Total pago pelos clientes, antes de custos, taxas e reembolsos."],
    ["Vendas", stats.totals.paidOrders, `${stats.store.paidOrders} na loja · ${stats.reseller.paidOrders} via API de revenda`],
    ["Ticket médio", money(stats.totals.averageTicketCents)],
    ["Loja / API de revenda", `${money(stats.store.revenueCents)} / ${money(stats.reseller.revenueCents)}`],
    ["Recargas de saldo", `${stats.topups.paidOrders} · ${money(stats.topups.revenueCents)}`, "Fora do faturamento: o saldo entra quando é usado."],
  ];
  return (
    <>
      <header className="admin-heading">
        <div>
          <small>SOMENTE LEITURA</small>
          <h1>Estatísticas</h1>
          <p>Vendas pagas ou entregues da loja e da API de revenda. Ficam de fora pedidos cancelados, de teste (PIX simulado), com pagamento reembolsado e vendas da API estornadas; recargas de saldo aparecem à parte.</p>
        </div>
      </header>
      <nav className="stats-periods" aria-label="Período">
        {STATS_PERIODS.map((value) => (
          <Link key={value} href={query({ periodo: value })} className={value === period ? "active" : ""}>{STATS_PERIOD_LABELS[value]}</Link>
        ))}
      </nav>
      <section className="metric-grid">
        {cards.map(([label, value, hint]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong>{hint && <small className="cell-subtitle">{hint}</small>}</article>)}
      </section>
      <section className="admin-section">
        <div className="section-title"><h2>Pedidos por status</h2></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr>{stats.statuses.map((row) => <th key={row.status}>{row.status}</th>)}</tr></thead>
            <tbody><tr>{stats.statuses.map((row) => <td key={row.status}>{row.count}</td>)}</tr></tbody>
          </table>
        </div>
        <p className="stats-note">Pedidos da loja no período, exceto cancelados, de teste, reembolsados e recargas — inclui pendentes e com falha para referência. Vendas da API de revenda não têm status de pedido.</p>
      </section>
      <div className="stats-grid">
        <CustomerTable title="Clientes por valor pago" rows={stats.customersByValue} />
        <CustomerTable title="Clientes por quantidade de pedidos" rows={stats.customersByCount} />
        <ProductTable title="Produtos por quantidade" rows={stats.productsByQuantity} />
        <ProductTable title="Produtos por valor" rows={stats.productsByValue} />
      </div>
      <section className="admin-section">
        <div className="section-title">
          <h2>Saldo dos clientes</h2>
          <Link href={query({ saldo: balanceSort === "desc" ? "asc" : "desc" })}>
            Ordenar por saldo {balanceSort === "desc" ? "↑ crescente" : "↓ decrescente"}
          </Link>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>Tier</th><th>Saldo</th><th>Saldo habilitado</th><th>Atualizado</th></tr></thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.userId}>
                  <td><Link href={customerHref(row.userId)}>{row.user.name}</Link><small className="cell-subtitle">{row.user.email}</small></td>
                  <td><span className="status-badge">{row.user.customerTier}</span></td>
                  <td>{money(row.balanceCents)}</td>
                  <td>{row.enabled ? "Sim" : "Não"}</td>
                  <td>{row.updatedAt.toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {balances.length === 0 && <p className="admin-empty">Nenhum cliente com conta de saldo.</p>}
        </div>
      </section>
    </>
  );
}
