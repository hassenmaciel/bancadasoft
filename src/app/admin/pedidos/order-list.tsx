"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminOrderDTO } from "@/lib/admin-order";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export default function OrderList({ initialOrders, orderStatuses, paymentStatuses, fulfillmentStatuses }: { initialOrders: AdminOrderDTO[]; orderStatuses: string[]; paymentStatuses: string[]; fulfillmentStatuses: string[] }) {
  const [query,setQuery]=useState(""); const [orderStatus,setOrderStatus]=useState("ALL"); const [paymentStatus,setPaymentStatus]=useState("ALL"); const [fulfillmentStatus,setFulfillmentStatus]=useState("ALL");
  const orders=useMemo(()=>{const term=query.trim().toLocaleLowerCase("pt-BR");return initialOrders.filter((order)=>{
    const searchable=`${order.id} ${order.publicToken} ${order.customer.name} ${order.customer.email}`.toLocaleLowerCase("pt-BR");
    return (!term||searchable.includes(term))&&(orderStatus==="ALL"||order.status===orderStatus)&&(paymentStatus==="ALL"||order.payment?.status===paymentStatus)&&(fulfillmentStatus==="ALL"||order.fulfillment?.status===fulfillmentStatus);
  });},[initialOrders,query,orderStatus,paymentStatus,fulfillmentStatus]);
  return <><header className="admin-heading"><div><small>OPERAÇÃO</small><h1>Pedidos</h1><p>Acompanhe pagamentos, entregas e o histórico operacional.</p></div></header>
    <section className="admin-filters order-filters"><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Buscar por ID, cliente ou e-mail"/><select value={orderStatus} onChange={(event)=>setOrderStatus(event.target.value)}><option value="ALL">Status do pedido</option>{orderStatuses.map((item)=><option key={item}>{item}</option>)}</select><select value={paymentStatus} onChange={(event)=>setPaymentStatus(event.target.value)}><option value="ALL">Pagamento</option>{paymentStatuses.map((item)=><option key={item}>{item}</option>)}</select><select value={fulfillmentStatus} onChange={(event)=>setFulfillmentStatus(event.target.value)}><option value="ALL">Fulfillment</option>{fulfillmentStatuses.map((item)=><option key={item}>{item}</option>)}</select></section>
    <section className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pedido / cliente</th><th>Item principal</th><th>Data</th><th>Total</th><th>Pedido</th><th>Pagamento</th><th>Fulfillment</th><th/></tr></thead><tbody>{orders.map((order)=><tr key={order.id}><td><div className="order-id"><b>#{order.id.slice(-8).toUpperCase()}</b><small>{order.customer.name}<br/>{order.customer.email}</small></div></td><td>{order.items[0]?.product.name??"Sem item"}<small className="table-sub">{order.items.length} {order.items.length===1?"item":"itens"}</small></td><td>{date(order.createdAt)}</td><td>{money(order.totalCents)}</td><td><span className={`status-badge status-${order.status.toLowerCase()}`}>{order.status}</span></td><td>{order.payment?<span className={`status-badge status-${order.payment.status.toLowerCase()}`}>{order.payment.status}</span>:"—"}</td><td>{order.fulfillment?<span className={`status-badge status-${order.fulfillment.status.toLowerCase()}`}>{order.fulfillment.status}</span>:"—"}</td><td><Link href={`/admin/pedidos/${order.id}`}>Ver pedido</Link></td></tr>)}</tbody></table>{!orders.length&&<p className="admin-empty">Nenhum pedido encontrado.</p>}</section>
  </>;
}
