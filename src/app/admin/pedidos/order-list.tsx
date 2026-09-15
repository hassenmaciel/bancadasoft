"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AdminOrderListDTO } from "@/lib/admin-order";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export default function OrderList({ initialOrders, orderStatuses, paymentStatuses, fulfillmentStatuses }: { initialOrders: AdminOrderListDTO[]; orderStatuses: string[]; paymentStatuses: string[]; fulfillmentStatuses: string[] }) {
  const [searchResults, setSearchResults] = useState<AdminOrderListDTO[] | null>(null);
  const [query, setQuery] = useState("");
  const [orderStatus, setOrderStatus] = useState("ALL");
  const [paymentStatus, setPaymentStatus] = useState("ALL");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const isDefault = !query.trim() && orderStatus === "ALL" && paymentStatus === "ALL" && fulfillmentStatus === "ALL";
  const orders = isDefault ? initialOrders : searchResults ?? [];

  // Busca sempre no servidor (PARTE 6/16): a listagem local não guarda mais
  // que a página atual — pedidos avulsos/antigos fora da amostra recente só
  // são encontrados consultando o banco pelo identificador informado.
  useEffect(() => {
    if (isDefault) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (orderStatus !== "ALL") params.set("orderStatus", orderStatus);
      if (paymentStatus !== "ALL") params.set("paymentStatus", paymentStatus);
      if (fulfillmentStatus !== "ALL") params.set("fulfillmentStatus", fulfillmentStatus);
      fetch(`/api/admin/orders?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
        .then(({ ok, body }) => {
          if (active && ok) setSearchResults(body.data ?? []);
        })
        .catch(() => {
          /* busca cancelada ou falhou silenciosamente; mantém resultado anterior */
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isDefault, query, orderStatus, paymentStatus, fulfillmentStatus]);

  return <><header className="admin-heading"><div><small>OPERAÇÃO</small><h1>Pedidos</h1><p>Acompanhe pagamentos, entregas e o histórico operacional.</p></div></header>
    <section className="admin-filters order-filters"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar por pedido, nome, e-mail, CPF, WhatsApp ou produto"/><select value={orderStatus} onChange={(event)=>setOrderStatus(event.target.value)}><option value="ALL">Status do pedido</option>{orderStatuses.map((item)=><option key={item}>{item}</option>)}</select><select value={paymentStatus} onChange={(event)=>setPaymentStatus(event.target.value)}><option value="ALL">Pagamento</option>{paymentStatuses.map((item)=><option key={item}>{item}</option>)}</select><select value={fulfillmentStatus} onChange={(event)=>setFulfillmentStatus(event.target.value)}><option value="ALL">Fulfillment</option>{fulfillmentStatuses.map((item)=><option key={item}>{item}</option>)}</select></section>
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pedido / cliente</th><th>CPF</th><th>WhatsApp</th><th>Origem</th><th>Item principal</th><th>Data</th><th>Total</th><th>Pedido</th><th>Pagamento</th><th>Fulfillment</th><th/></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td><div className="order-id"><b>#{order.id.slice(-8).toUpperCase()}</b><small>{order.customer.name}<br/>{order.customer.email}</small></div></td><td>{order.customer.cpfMasked??"—"}</td><td>{order.customer.whatsapp??"—"}</td><td><span className={`status-badge ${order.customer.guest?"origin-guest":"origin-account"}`}>{order.customer.guest?"AVULSO":"CADASTRADO"}</span></td><td>{order.items[0]?.productName??"Sem item"}{order.items[0]?.variant&&<small className="table-sub">{order.items[0].variant}</small>}<small className="table-sub">{order.items.length} {order.items.length===1?"item":"itens"}</small></td><td>{date(order.createdAt)}</td><td>{money(order.totalCents)}</td><td><span className={`status-badge status-${order.status.toLowerCase()}`}>{order.status}</span></td><td>{order.paymentStatus?<span className={`status-badge status-${order.paymentStatus.toLowerCase()}`}>{order.paymentStatus}</span>:"—"}</td><td>{order.fulfillmentStatus?<span className={`status-badge status-${order.fulfillmentStatus.toLowerCase()}`}>{order.fulfillmentStatus}</span>:"—"}</td><td><Link href={`/admin/pedidos/${order.id}`}>Ver pedido</Link></td></tr>)}</tbody></table>{loading&&<p className="admin-empty">Buscando…</p>}{!loading&&!orders.length&&<p className="admin-empty">Nenhum pedido encontrado.</p>}</section>
  </>;
}
