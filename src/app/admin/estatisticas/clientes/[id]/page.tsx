import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCustomerHistory, paymentMethodLabel } from "@/lib/admin-statistics";

export const dynamic = "force-dynamic";
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const date = (value: Date) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(value);

export default async function CustomerHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const customer = await getCustomerHistory(id);
  if (!customer) notFound();
  return (
    <>
      <header className="admin-heading">
        <div>
          <small>HISTÓRICO DO CLIENTE</small>
          <h1>{customer.name}</h1>
          <p>
            {customer.email} · {customer.customerTier} · {customer.active ? "Ativo" : "Inativo"} · Saldo atual{" "}
            {money(customer.accountBalance?.balanceCents ?? 0)}
          </p>
          <p>Total que entra nas estatísticas (todo o período, loja + API de revenda): {money(customer.countedCents)}</p>
        </div>
        <Link href="/admin/estatisticas">← Estatísticas</Link>
      </header>
      <section className="admin-section">
        <div className="section-title"><h2>Pedidos ({customer.orders.length})</h2></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Data</th><th>Origem</th><th>Pedido</th><th>Produto</th><th>Valor</th><th>Status</th><th>Pagamento</th><th>Nas estatísticas</th></tr></thead>
            <tbody>
              {customer.orders.map((order) => (
                <tr key={order.id}>
                  <td>{date(order.createdAt)}</td>
                  <td>Loja</td>
                  <td><Link href={`/admin/pedidos/${order.id}`}>{order.publicToken.slice(0, 10)}</Link></td>
                  <td>
                    {order.items.map((item, index) => (
                      <span key={index} style={{ display: "block" }}>
                        {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.product.name}
                        {item.productVariant ? <small className="cell-subtitle">{item.productVariant.name}</small> : null}
                      </span>
                    ))}
                  </td>
                  <td>{money(order.totalCents)}</td>
                  <td><span className="status-badge">{order.status}</span></td>
                  <td>{paymentMethodLabel(order.payment?.provider)}<small className="cell-subtitle">{order.payment?.status ?? "SEM PAGAMENTO"}</small></td>
                  <td>{order.countsAsSale ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {customer.orders.length === 0 && <p className="admin-empty">Cliente sem pedidos.</p>}
        </div>
      </section>
      <section className="admin-section">
        <div className="section-title"><h2>Vendas via API de revenda ({customer.resellerSales.length})</h2></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Data</th><th>Origem</th><th>Referência</th><th>Produto</th><th>Valor</th><th>Status</th><th>Nas estatísticas</th></tr></thead>
            <tbody>
              {customer.resellerSales.map((sale) => (
                <tr key={sale.entryId}>
                  <td>{date(sale.createdAt)}</td>
                  <td>API de revenda</td>
                  <td>{sale.externalReference}</td>
                  <td>{sale.productName}</td>
                  <td>{money(sale.amountCents)}</td>
                  <td><span className="status-badge">{sale.refunded ? "ESTORNADA" : "DEBITADA"}</span></td>
                  <td>{sale.refunded ? "Não" : "Sim"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {customer.resellerSales.length === 0 && <p className="admin-empty">Sem vendas via API de revenda.</p>}
        </div>
      </section>
      <section className="admin-section">
        <div className="section-title"><h2>Movimentações de saldo ({customer.ledgerEntries.length})</h2></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Saldo após</th><th>Pedido</th><th>Observação</th></tr></thead>
            <tbody>
              {customer.ledgerEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{date(entry.createdAt)}</td>
                  <td><span className="status-badge">{entry.type}</span></td>
                  <td>{money(entry.amountCents)}</td>
                  <td>{money(entry.balanceAfterCents)}</td>
                  <td>{entry.sourceOrderId ? <Link href={`/admin/pedidos/${entry.sourceOrderId}`}>Ver pedido</Link> : "—"}</td>
                  <td>{entry.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {customer.ledgerEntries.length === 0 && <p className="admin-empty">Sem movimentações de saldo.</p>}
        </div>
      </section>
    </>
  );
}
