"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OrderDTO, ProductDTO } from "@/lib/dto";
import { createOrderPoller } from "@/lib/order-polling";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

function ProductImage({ product }: { product: ProductDTO }) {
  const [failed, setFailed] = useState(false);
  if (!product.imageUrl || failed) return <span>{product.name.slice(0, 3).toUpperCase()}</span>;
  return <Image src={product.imageUrl} alt={product.name} fill sizes="220px" unoptimized onError={() => setFailed(true)} />;
}

export default function Home() {
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [selected, setSelected] = useState<ProductDTO | null>(null);
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [maintenance, setMaintenance] = useState("");

  useEffect(() => {
    fetch("/api/products", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (response.status === 503 && payload.maintenance) { setMaintenance(payload.message); return; }
        if (!response.ok) throw new Error(payload.error || "Falha ao carregar o catálogo.");
        setProducts(payload.data ?? []);
      })
      .catch((error: Error) => setNotice(error.message))
      .finally(() => setLoading(false));
  }, []);


  useEffect(() => {
    if (!order) return;
    const poller = createOrderPoller({
      initialOrder: order,
      fetchOrder: async () => {
        const response = await fetch(`/api/orders/${order.id}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o pedido.");
        return payload.data as OrderDTO;
      },
      onUpdate: setOrder,
    });
    poller.start();
    return poller.stop;
  }, [order]);

  const availableCategories = useMemo(
    () => Array.from(new Map(products.filter((product) => product.category).map((product) => [product.category!.id, product.category!])).values()),
    [products],
  );

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return products.filter((product) => {
      const matchesCategory = category === "ALL" || product.category?.id === category;
      const searchable = `${product.name} ${product.description ?? ""} ${product.category?.name ?? ""} ${product.brand?.name ?? ""}`.toLocaleLowerCase("pt-BR");
      return matchesCategory && (!term || searchable.includes(term));
    });
  }, [category, products, query]);

  function selectCategory(type: string) {
    setCategory(type);
    document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });
  }

  function selectCategoryByName(name: string) {
    const match = availableCategories.find((item) => item.name.toLocaleLowerCase("pt-BR").includes(name));
    selectCategory(match?.id ?? "ALL");
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    document.getElementById("catalogo")?.scrollIntoView({ behavior: "smooth" });
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || submitting) return;
    setSubmitting(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: selected.id,
          name: form.get("name"),
          email: form.get("email"),
          whatsapp: form.get("whatsapp"),
          cpfCnpj: String(form.get("cpfCnpj") ?? "").replace(/\D/g, ""),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível criar o pedido.");
      setOrder(payload.data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível criar o pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  async function pay() {
    if (!order || submitting) return;
    setSubmitting(true);
    setNotice("");
    try {
      const response = await fetch("/api/webhooks/payments/sandbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: crypto.randomUUID(), orderId: order.id, status: "paid" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível confirmar o pagamento.");
      setOrder(payload.data.order);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível confirmar o pagamento.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeCheckout() {
    setSelected(null);
    setOrder(null);
    setNotice("");
    setCopied(false);
  }

  async function copyPix() {
    if (!order?.payment?.pixPayload) return;
    await navigator.clipboard.writeText(order.payment.pixPayload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (maintenance) return <main className="maintenance-screen"><section><strong>BANCADA<span>SOFT</span></strong><h1>Estamos em manutenção</h1><p>{maintenance}</p><small>Webhooks e pedidos já iniciados continuam sendo processados.</small></section></main>;

  return (
    <main>
      <header className="site-header">
        <div className="wrap header-main">
          <Link className="brand" href="/" aria-label="BancadaSoft - início">
            BANCADA<span>SOFT</span>
            <small>Ferramentas e serviços para técnicos</small>
          </Link>
          <form className="search" onSubmit={submitSearch} role="search">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="O que você procura? Ex.: UnlockTool, Samsung, FRP..."
              aria-label="Pesquisar produtos"
            />
            <button type="submit" aria-label="Buscar">⌕</button>
          </form>
          <div className="account">
            <Link href="/login">Entrar</Link>
            <Link href="/meus-pedidos">Meus pedidos</Link>
          </div>
        </div>
        <nav className="nav-bar" aria-label="Navegação principal">
          <div className="wrap nav-inner">
            <a className="active" href="#inicio">⌂ Início</a>
            <a href="#catalogo">⚙ Ferramentas</a>
            <button onClick={() => selectCategoryByName("alug")}>▣ Aluguéis</button>
            <button onClick={() => selectCategoryByName("licen")}>▤ Licenças</button>
            <button onClick={() => selectCategoryByName("servi")}>⌘ Serviços</button>
            <button onClick={() => selectCategoryByName("crédit")}>▰ Créditos</button>
            <a href="#catalogo">★ Mais vendidos</a>
            <a href="#suporte">◉ Suporte</a>
          </div>
        </nav>
      </header>

      <section className="hero" id="inicio">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Plataforma para assistência técnica</span>
            <h1>Encontrou.<br />Pagou.<br /><em>Liberou.</em></h1>
            <p>Todas as ferramentas que o técnico precisa, com liberação automática e pagamento via PIX.</p>
            <div className="hero-actions">
              <a className="primary-cta" href="#catalogo">Ver catálogo</a>
              <a className="secondary-cta" href="#como-funciona">Como funciona</a>
            </div>
            <div className="trust-row">
              <span><b>↯</b> Liberação<br />automática</span>
              <span><b>▣</b> Pagamento<br />seguro</span>
              <span><b>◉</b> Suporte<br />em português</span>
            </div>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="device-glow" />
            <div className="phone">
              <div className="phone-notch" />
              <div className="phone-message">Soluções para quem<br />faz mais com técnica.</div>
              <div className="phone-brand">BANCADA<span>SOFT</span></div>
            </div>
          </div>
          <aside className="hero-list">
            <strong>+ de 1000</strong>
            <small>ferramentas e serviços</small>
            <ul>
              <li>Aluguéis por horas</li>
              <li>Licenças originais</li>
              <li>Serviços remotos</li>
              <li>Créditos e ativações</li>
              <li>Tudo em um só lugar</li>
            </ul>
          </aside>
        </div>
      </section>

      <section className="wrap quick-links" aria-label="Categorias">
        {availableCategories.map((item, index) => (
          <button key={item.id} onClick={() => selectCategory(item.id)} className={category === item.id ? "selected" : ""}>
            <span className="category-icon">{["⚙", "↯", "◆", "◎", "▰"][index % 5]}</span>
            <span><b>{item.name}</b><small>Ver produtos desta categoria</small></span>
          </button>
        ))}
      </section>

      <section className="wrap catalogue" id="catalogo">
        <div className="section-title">
          <div><h2><span>♦</span> Mais procurados</h2><p>Ferramentas e serviços disponíveis no catálogo BancadaSoft.</p></div>
          <span>{visibleProducts.length} {visibleProducts.length === 1 ? "resultado" : "resultados"}</span>
        </div>
        <div className="catalogue-toolbar">
          <button className={category === "ALL" ? "active" : ""} onClick={() => setCategory("ALL")}>Todos</button>
          {availableCategories.map((item) => (
            <button key={item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>
              {item.name}
            </button>
          ))}
        </div>
        {notice && !selected && <p className="notice error">{notice}</p>}
        {loading ? (
          <div className="products" aria-label="Carregando produtos">
            {[1, 2, 3].map((item) => <div className="product skeleton" key={item} />)}
          </div>
        ) : visibleProducts.length ? (
          <div className="products">
            {visibleProducts.map((product, index) => (
              <article className="product" key={product.id}>
                <div className={`product-art art-${index % 4}`}>
                  <ProductImage product={product} />
                </div>
                <span className="product-type">{product.category?.name ?? "Sem categoria"}</span>
                <h3>{product.name}</h3>
                <p>{product.duration || product.description || "Disponível para ativação"}</p>
                <strong>{money(product.priceCents)}</strong>
                <small className={product.available ? "available" : "unavailable"}>{product.available ? "↯ Disponível para compra" : "Indisponível no momento"}</small>
                <button disabled={!product.available} onClick={() => setSelected(product)}>Comprar agora</button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state"><b>Nenhum produto encontrado.</b><span>Tente outro termo ou selecione “Todos”.</span></div>
        )}
      </section>

      <section className="wrap pix-strip">
        <div className="pix-brand"><span>◆</span> pix</div>
        <p>Pague com <b>PIX</b><br />e receba seu acesso na hora!</p>
        <div className="pix-points"><span>◷ Pagamento rápido</span><span>▣ Ambiente seguro</span><span>↯ Liberação automática</span></div>
      </section>

      <section className="wrap benefits">
        <article><span>✓</span><div><b>Catálogo atualizado</b><small>As soluções que o técnico procura.</small></div></article>
        <article><span>♟</span><div><b>Suporte especializado</b><small>Atendimento em português.</small></div></article>
        <article><span>▣</span><div><b>Compra sem burocracia</b><small>Rápido, simples e seguro.</small></div></article>
        <article><span>★</span><div><b>Preços competitivos</b><small>Mais economia para o dia a dia.</small></div></article>
      </section>

      <section className="wrap how" id="como-funciona">
        <h2>Como funciona?</h2>
        <p>Em poucos passos você recebe acesso à sua ferramenta.</p>
        <div className="steps">
          <article><span>1</span><div><b>Escolha a ferramenta</b><small>Encontre o que precisa no catálogo.</small></div></article>
          <article><span>2</span><div><b>Pague com PIX</b><small>Pagamento rápido e seguro.</small></div></article>
          <article><span>3</span><div><b>Receba seu acesso</b><small>Liberação automática após confirmação.</small></div></article>
          <article><span>4</span><div><b>Comece a usar</b><small>Siga as instruções e pronto.</small></div></article>
        </div>
      </section>

      <section className="support" id="suporte">
        <div className="wrap support-inner">
          <div className="support-brand"><span>⚒</span><div><b>BANCADA<span>SOFT</span></b><small>Mais que uma loja, um parceiro para o técnico.</small></div></div>
          <div className="support-copy"><span>●</span><div><b>Precisando de ajuda?</b><small>Fale com nosso suporte especializado.</small></div></div>
          <a href="mailto:suporte@bancadasoft.com">Falar com o suporte</a>
        </div>
      </section>

      <footer>
        <div className="wrap footer-grid">
          <div className="footer-brand"><b>BANCADA<span>SOFT</span></b><small>Ferramentas e serviços para técnicos.</small></div>
          <div><b>Institucional</b><a href="#inicio">Quem somos</a><a href="#como-funciona">Como funciona</a></div>
          <div><b>Ajuda</b><a href="#suporte">Central de ajuda</a><Link href="/meus-pedidos">Meus pedidos</Link></div>
          <div><b>Formas de pagamento</b><span className="footer-pix">◆ pix</span></div>
        </div>
        <div className="wrap copyright">© 2026 BancadaSoft. Todos os direitos reservados.<span>Feito para quem faz o mobile acontecer.</span></div>
      </footer>

      {selected && !order && (
        <dialog open>
          <form onSubmit={checkout}>
            <button type="button" className="close" onClick={closeCheckout} aria-label="Fechar">×</button>
            <span className="dialog-kicker">Checkout seguro</span>
            <h2>Finalizar com PIX</h2>
            <p>{selected.name} · <b>{money(selected.priceCents)}</b></p>
            {notice && <p className="notice error">{notice}</p>}
            <label>Nome completo<input name="name" autoComplete="name" required /></label>
            <label>WhatsApp<input name="whatsapp" autoComplete="tel" required /></label>
            <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
            <label>CPF ou CNPJ<input name="cpfCnpj" inputMode="numeric" autoComplete="off" minLength={11} maxLength={18} required /></label>
            <button className="primary" disabled={submitting}>{submitting ? "Criando pedido..." : "Gerar PIX"}</button>
          </form>
        </dialog>
      )}

      {order && (
        <dialog open>
          <div className="order">
            <button type="button" className="close" onClick={closeCheckout} aria-label="Fechar">×</button>
            <span className="dialog-kicker">Pedido {order.id.slice(0, 8)}</span>
            <h2>{order.fulfillment?.delivery ? "Acesso liberado!" : order.payment?.status === "PAID" ? "Pagamento confirmado" : "Aguardando pagamento"}</h2>
            <p>{order.items.map((item) => item.product.name).join(", ")}</p>
            {order.payment && <div className="pix-payment">
              {order.payment.qrCodeImage && <div className="qr-frame"><Image src={order.payment.qrCodeImage} width={220} height={220} unoptimized alt="QR Code PIX do pedido" /></div>}
              <strong>{money(order.payment.amountCents)}</strong>
              <span className="payment-status">{order.payment.status === "PAID" ? "Pagamento confirmado" : order.payment.status === "PENDING" ? "Pagamento pendente" : `Pagamento ${order.payment.status.toLowerCase()}`}</span>
              {order.payment.pixPayload && <><code>{order.payment.pixPayload}</code><button type="button" className="copy-pix" onClick={copyPix}>{copied ? "PIX copiado" : "Copiar PIX"}</button></>}
              {order.payment.expirationDate && <small>Expira em {new Date(order.payment.expirationDate).toLocaleString("pt-BR")}</small>}
            </div>}
            {order.payment?.provider === "mock" && order.status !== "DELIVERED" && <button className="primary" onClick={pay} disabled={submitting}>{submitting ? "Confirmando..." : "Simular pagamento"}</button>}
            {order.fulfillment?.delivery && (
              <div className="delivery"><b>Entrega disponível</b><p>{order.fulfillment.delivery.instructions}</p></div>
            )}
            {notice && <p className="notice error">{notice}</p>}
          </div>
        </dialog>
      )}
    </main>
  );
}
