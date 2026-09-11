"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { OrderDTO, ProductDTO } from "@/lib/dto";
import { createOrderPoller } from "@/lib/order-polling";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

export default function CheckoutPanel({ product }: { product: ProductDTO }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!order) return;
    const poller = createOrderPoller({
      initialOrder: order,
      fetchOrder: async () => {
        const response = await fetch(`/api/orders/${order.id}?token=${encodeURIComponent(order.publicToken)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o pedido.");
        return payload.data as OrderDTO;
      },
      onUpdate: setOrder,
    });
    poller.start();
    return poller.stop;
  }, [order]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId: product.id, name: form.get("name"), email: form.get("email"), whatsapp: form.get("whatsapp"), cpfCnpj: String(form.get("cpfCnpj") ?? "").replace(/\D/g, "") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível criar o pedido.");
      setOrder(payload.data);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível criar o pedido."); }
    finally { setSubmitting(false); }
  }

  async function copyPix() {
    if (!order?.payment?.pixPayload) return;
    await navigator.clipboard.writeText(order.payment.pixPayload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  function close() { setOpen(false); setOrder(null); setNotice(""); setCopied(false); }

  return <>
    <button className="product-buy" disabled={!product.available} onClick={() => setOpen(true)}>{product.available ? "Comprar com PIX" : "Indisponível"}</button>
    {open && !order && <dialog open><form onSubmit={checkout}><button type="button" className="close" onClick={close} aria-label="Fechar">×</button><span className="dialog-kicker">Checkout seguro</span><h2>Finalizar com PIX</h2><p>{product.name} · <b>{money(product.priceCents)}</b></p>{notice && <p className="notice error">{notice}</p>}<label>Nome completo<input name="name" autoComplete="name" required /></label><label>WhatsApp<input name="whatsapp" autoComplete="tel" required /></label><label>E-mail<input name="email" type="email" autoComplete="email" required /></label><label>CPF ou CNPJ<input name="cpfCnpj" inputMode="numeric" autoComplete="off" minLength={11} maxLength={18} required /></label><button className="primary" disabled={submitting}>{submitting ? "Criando pedido..." : "Gerar PIX"}</button></form></dialog>}
    {open && order && <dialog open><div className="order"><button type="button" className="close" onClick={close} aria-label="Fechar">×</button><span className="dialog-kicker">Pedido {order.publicToken.slice(0, 8)}</span><h2>{order.fulfillment?.delivery ? "Acesso liberado!" : order.payment?.status === "PAID" ? "Pagamento confirmado" : "Aguardando pagamento"}</h2><p>{order.items.map((item) => item.product.name).join(", ")}</p>{order.payment && <div className="pix-payment">{order.payment.qrCodeImage && <div className="qr-frame"><Image src={order.payment.qrCodeImage} width={220} height={220} unoptimized alt="QR Code PIX do pedido" /></div>}<strong>{money(order.payment.amountCents)}</strong><span className="payment-status">{order.payment.status === "PAID" ? "Pagamento confirmado" : "Pagamento pendente"}</span>{order.payment.pixPayload && <><code>{order.payment.pixPayload}</code><button type="button" className="copy-pix" onClick={copyPix}>{copied ? "PIX copiado" : "Copiar PIX"}</button></>}</div>}{order.fulfillment?.delivery && <div className="delivery"><b>Entrega disponível</b><p>{order.fulfillment.delivery.instructions}</p></div>}<Link className="order-link" href={`/meus-pedidos/${order.id}`}>Acompanhar em Meus pedidos</Link>{notice && <p className="notice error">{notice}</p>}</div></dialog>}
  </>;
}
