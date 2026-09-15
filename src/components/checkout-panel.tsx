"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryDTO, OrderDTO, ProductDTO } from "@/lib/dto";
import { createOrderPoller, isActiveCheckoutOrder } from "@/lib/order-polling";
import CredentialDelivery from "@/components/credential-delivery";
import {
  checkoutErrorMessage,
  createCheckoutSubmissionGuard,
  readCheckoutResponse,
} from "@/lib/checkout-response";
import {
  needsGuestCheckoutRecovery,
  parseSavedCheckoutReference,
} from "@/lib/checkout-recovery";

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    value / 100,
  );

export default function CheckoutPanel({ product }: { product: ProductDTO }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryDTO | null>(null);
  const [variantId, setVariantId] = useState(product.variants.length === 1 ? product.variants[0].id : "");
  const submitGuard = useRef(createCheckoutSubmissionGuard());
  const modalRef = useRef<HTMLDialogElement | null>(null);
  const storageKey = `bancadasoft:checkout:${product.id}`;
  const clearActiveCheckout = useCallback(
    () => localStorage.removeItem(storageKey),
    [storageKey],
  );
  const paid = order?.payment?.status === "PAID";
  const delivered = order?.status === "DELIVERED" && !!delivery;
  const failed = order?.status === "FAILED";
  const selectedVariant = product.variants.find((variant) => variant.id === variantId);
  const checkoutFields = selectedVariant?.checkoutFields ?? product.checkoutFields;

  async function loadDelivery(orderId: string) {
    const token = localStorage.getItem(`bancadasoft:delivery:${orderId}`);
    if (!token) return;
    const response = await fetch(`/api/orders/${orderId}/delivery`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.data.delivery) setDelivery(payload.data.delivery);
  }
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    const ref = parseSavedCheckoutReference(saved);
    if (!ref) {
      localStorage.removeItem(storageKey);
      return;
    }
    let active = true;
    const restore = async () => {
      try {
        const response = needsGuestCheckoutRecovery(ref)
          ? await fetch("/api/checkout/recover", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                deliveryAccessToken: ref.deliveryAccessToken,
              }),
              cache: "no-store",
            })
          : await fetch(
              `/api/orders/${ref.id}?token=${encodeURIComponent(ref.publicToken!)}`,
              { cache: "no-store" },
            );
        const payload = await readCheckoutResponse(response);
        if (!response.ok || !payload?.data || !active) {
          if (response.status === 400 || response.status === 404)
            localStorage.removeItem(storageKey);
          return;
        }
        // Fonte da verdade é o estado do pedido no banco: um pedido terminal
        // (DELIVERED/FAILED/CANCELLED) nunca reabre o checkout automaticamente
        // nesta página — apenas o recovery explícito (link/e-mail) faz isso.
        if (!isActiveCheckoutOrder(payload.data)) {
          clearActiveCheckout();
          return;
        }
        const deliveryAccessToken =
          ref.deliveryAccessToken ?? payload.deliveryAccessToken;
        setOrder(payload.data);
        setOpen(true);
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            id: payload.data.id,
            publicToken: payload.data.publicToken,
            deliveryAccessToken,
          }),
        );
        if (deliveryAccessToken)
          localStorage.setItem(
            `bancadasoft:delivery:${payload.data.id}`,
            deliveryAccessToken,
          );
      } catch {
        if (active) setOpen(true);
      }
    };
    void restore();
    return () => {
      active = false;
    };
  }, [storageKey, clearActiveCheckout]);
  useEffect(() => {
    if (!order) return;
    const poller = createOrderPoller({
      initialOrder: order,
      fetchOrder: async () => {
        const response = await fetch(
          `/api/orders/${order.id}?token=${encodeURIComponent(order.publicToken)}`,
          { cache: "no-store" },
        );
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error || "Não foi possível atualizar o pedido.",
          );
        return payload.data;
      },
      onUpdate: (updated) => {
        setOrder(updated);
        if (updated.status === "DELIVERED") void loadDelivery(updated.id);
        // Assim que o fulfillment chega a um estado terminal, o pedido deixa de
        // ser o "checkout ativo" deste produto — a tela aberta continua mostrando
        // o resultado normalmente, mas uma nova visita à página não deve reabri-la.
        if (!isActiveCheckoutOrder(updated)) clearActiveCheckout();
      },
    });
    poller.start();
    return poller.stop;
  }, [order, clearActiveCheckout]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitGuard.current.acquire()) return;
    setSubmitting(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      let deliveryAccessToken = "";
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          deliveryAccessToken =
            (JSON.parse(saved) as { deliveryAccessToken?: string })
              .deliveryAccessToken ?? "";
        } catch {}
      }
      if (!deliveryAccessToken) {
        deliveryAccessToken = crypto.randomUUID();
        localStorage.setItem(
          storageKey,
          JSON.stringify({ deliveryAccessToken }),
        );
      }
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          variantId: product.variants.length ? variantId : undefined,
          name: form.get("name"),
          email: form.get("email"),
          whatsapp: form.get("whatsapp"),
          cpfCnpj: String(form.get("cpfCnpj") ?? "").replace(/\D/g, ""),
          deliveryAccessToken,
          providerFields: Object.fromEntries(
            checkoutFields.map((field) => [field.key, String(form.get(`provider:${field.key}`) ?? "")]),
          ),
        }),
      });
      const payload = await readCheckoutResponse(response);
      if (!response.ok || !payload?.data || !payload.deliveryAccessToken)
        throw new Error(checkoutErrorMessage(response.status, payload));
      setOrder(payload.data);
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          id: payload.data.id,
          publicToken: payload.data.publicToken,
          deliveryAccessToken,
        }),
      );
      localStorage.setItem(
        `bancadasoft:delivery:${payload.data.id}`,
        payload.deliveryAccessToken,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Não foi possível criar o pedido.",
      );
    } finally {
      submitGuard.current.release();
      setSubmitting(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    // Garante que o topo do checkout (primeiro campo) fique visível ao abrir,
    // mesmo com a página rolada — necessário porque o modal usa position:absolute
    // no mobile (para evitar bugs de teclado do Safari com position:fixed) e por
    // isso herda a posição de rolagem do documento em vez do viewport.
    modalRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [open]);
  async function copyPix() {
    if (!order?.payment?.pixPayload) return;
    await navigator.clipboard.writeText(order.payment.pixPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  function close() {
    if (submitting) return;
    // X fecha apenas a experiência atual. Se o pedido já é terminal, também limpa
    // a referência de "checkout ativo" para liberar uma nova compra deste produto;
    // pedidos PENDING_PAYMENT/PROCESSING preservam a referência para recovery.
    if (order && !isActiveCheckoutOrder(order)) clearActiveCheckout();
    setOpen(false);
    setOrder(null);
    setNotice("");
    setCopied(false);
    setDelivery(null);
  }

  return (
    <>
      <button
        className="product-buy"
        disabled={!product.available}
        onClick={() => setOpen(true)}
      >
        {product.available ? "COMPRAR COM PIX" : "Indisponível"}
      </button>
      {open && (
        <dialog
          ref={modalRef}
          className="checkout-modal"
          open
          aria-labelledby="checkout-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <button
            type="button"
            className="checkout-close"
            onClick={close}
            disabled={submitting}
            aria-label="Fechar checkout"
          >
            ×
          </button>
          <div className="checkout-shell">
            <section className="checkout-main">
              {!order ? (
                <form
                  className="checkout-form"
                  onSubmit={checkout}
                  noValidate={false}
                >
                  <span className="checkout-kicker">✓ Checkout seguro</span>
                  <h2 id="checkout-title">Finalize sua compra</h2>
                  <p className="checkout-lead">
                    Preencha seus dados para gerar o PIX.
                    <br />
                    Não é necessário criar uma conta.
                  </p>
                  <div className="checkout-fields">
                    {product.variants.length > 0 && (
                      <label htmlFor="checkout-variant">
                        Variante
                        <select
                          id="checkout-variant"
                          value={variantId}
                          onChange={(event) => setVariantId(event.target.value)}
                          required
                        >
                          <option value="">Selecione a variante</option>
                          {product.variants.filter((variant) => variant.priceCents !== null).map((variant) => (
                            <option key={variant.id} value={variant.id}>
                              {variant.name} — {money(variant.priceCents!)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label htmlFor="checkout-name">
                      Nome completo
                      <input
                        id="checkout-name"
                        name="name"
                        autoComplete="name"
                        placeholder="Seu nome completo"
                        required
                      />
                    </label>
                    <label htmlFor="checkout-cpf">
                      CPF <em>obrigatório</em>
                      <input
                        id="checkout-cpf"
                        name="cpfCnpj"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00"
                        minLength={11}
                        maxLength={14}
                        onInput={(event) => {
                          const input = event.currentTarget;
                          const digits = input.value
                            .replace(/\D/g, "")
                            .slice(0, 11);
                          input.value = digits
                            .replace(/(\d{3})(\d)/, "$1.$2")
                            .replace(/(\d{3})(\d)/, "$1.$2")
                            .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
                        }}
                        required
                      />
                    </label>
                    <label htmlFor="checkout-email">
                      E-mail
                      <input
                        id="checkout-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="seu@email.com"
                        required
                      />
                    </label>
                    <label htmlFor="checkout-whatsapp">
                      WhatsApp
                      <input
                        id="checkout-whatsapp"
                        name="whatsapp"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(00) 00000-0000"
                        minLength={10}
                        maxLength={16}
                        onInput={(event) => {
                          const input = event.currentTarget;
                          const digits = input.value
                            .replace(/\D/g, "")
                            .slice(0, 11);
                          input.value = digits
                            .replace(/^(\d{2})(\d)/, "($1) $2")
                            .replace(/(\d{5})(\d{4})$/, "$1-$2");
                        }}
                        required
                      />
                    </label>
                    {checkoutFields.map((field) => (
                      <label key={field.key} htmlFor={`checkout-provider-${field.key}`}>
                        {field.label}
                        {field.type === "textarea" ? (
                          <textarea
                            id={`checkout-provider-${field.key}`}
                            name={`provider:${field.key}`}
                            placeholder={field.placeholder}
                            required={field.required}
                            minLength={field.validation?.minLength}
                            maxLength={field.validation?.maxLength}
                          />
                        ) : (
                          <input
                            id={`checkout-provider-${field.key}`}
                            name={`provider:${field.key}`}
                            type={field.type === "email" ? "email" : field.type === "number" || field.type === "imei" ? "text" : "text"}
                            inputMode={field.type === "number" || field.type === "imei" ? "numeric" : undefined}
                            placeholder={field.placeholder}
                            required={field.required}
                            minLength={field.validation?.minLength}
                            maxLength={field.validation?.maxLength}
                            pattern={field.validation?.pattern}
                            autoComplete="off"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                  {notice && (
                    <p className="checkout-error" role="alert">
                      {notice}
                    </p>
                  )}
                  <button
                    className="checkout-submit"
                    disabled={submitting}
                    aria-busy={submitting}
                  >
                    {submitting ? (
                      <>
                        <span className="button-spinner" />
                        GERANDO PIX...
                      </>
                    ) : (
                      <>▣ GERAR PIX</>
                    )}
                  </button>
                  <div className="checkout-security">
                    <span>▣</span>
                    <p>
                      <b>COMPRA SEGURA</b>Seus dados são utilizados somente para
                      processar esta compra.
                    </p>
                  </div>
                </form>
              ) : (
                <div className="checkout-state" aria-live="polite">
                  {delivered ? (
                    <>
                      <span className="state-icon state-success">✓</span>
                      <span className="checkout-kicker">Pedido concluído</span>
                      <h2 id="checkout-title">Acesso liberado</h2>
                      <div className="progress-checks">
                        <span>✓ Pagamento confirmado</span>
                        <span>✓ Liberação concluída</span>
                      </div>
                      <p>Seu acesso está pronto para uso.</p>
                      <CredentialDelivery {...delivery} />
                      <p className="checkout-guidance">
                        Guarde essas informações até finalizar o período de uso.
                      </p>
                      <p className="email-note">
                        Também enviamos um link de recuperação para seu e-mail.
                      </p>
                    </>
                  ) : failed ? (
                    <>
                      <span className="state-icon state-wait">!</span>
                      <h2 id="checkout-title">
                        Estamos concluindo sua liberação
                      </h2>
                      <p>
                        Aguarde alguns instantes. Se necessário, nossa equipe
                        acompanhará o pedido.
                      </p>
                    </>
                  ) : paid ? (
                    <>
                      <span className="state-icon state-success">✓</span>
                      <span className="checkout-kicker">
                        Pagamento confirmado
                      </span>
                      <h2 id="checkout-title">Liberando seu acesso...</h2>
                      <div className="processing-line">
                        <span />
                        <span />
                        <span />
                      </div>
                      <p>Não é necessário atualizar ou clicar novamente.</p>
                    </>
                  ) : (
                    <>
                      <span className="checkout-kicker">Pagamento via PIX</span>
                      <h2 id="checkout-title">Aguardando pagamento</h2>
                      <div className="pix-status">
                        <span />
                        Aguardando confirmação do pagamento
                      </div>
                      {order.payment && (
                        <div className="pix-layout">
                          <div className="qr-frame">
                            {order.payment.qrCodeImage && (
                              <Image
                                src={order.payment.qrCodeImage}
                                width={210}
                                height={210}
                                unoptimized
                                alt="QR Code PIX do pedido"
                              />
                            )}
                          </div>
                          <div className="pix-details">
                            <small>VALOR</small>
                            <strong>{money(order.payment.amountCents)}</strong>
                            <label>
                              PIX COPIA E COLA
                              <code>{order.payment.pixPayload}</code>
                            </label>
                            <button
                              type="button"
                              className="copy-pix"
                              onClick={copyPix}
                            >
                              {copied ? "COPIADO ✓" : "COPIAR PIX"}
                            </button>
                          </div>
                        </div>
                      )}
                      <p className="checkout-guidance">
                        Após realizar o pagamento, aguarde nesta página. Seu
                        acesso será liberado automaticamente.
                      </p>
                      <p className="checkout-warning">
                        Não feche esta janela até seu login ser exibido.
                      </p>
                      <p className="checkout-recovery">
                        Se fechar por engano, você poderá recuperar o acesso
                        pelo link enviado ao seu e-mail.
                      </p>
                    </>
                  )}
                  <Link
                    className="order-link checkout-order-link"
                    href={`/acompanhar/${order.id}`}
                  >
                    Acompanhar pedido em página separada
                  </Link>
                </div>
              )}
            </section>
            <aside className="checkout-summary">
              <span className="summary-brand">
                BANCADA<span>SOFT</span>
              </span>
              <div className="summary-art">
                {product.imageUrl ? (
                  <Image
                    src={product.imageUrl}
                    alt={product.name}
                    width={180}
                    height={150}
                    unoptimized
                  />
                ) : (
                  <b>{product.name.slice(0, 2).toUpperCase()}</b>
                )}
              </div>
              <span className="summary-type">
                {product.type === "RENTAL" ? "ALUGUEL" : "FERRAMENTA"}
              </span>
              <h3>{product.name}</h3>
              <p>
                {product.duration ??
                  product.deliveryEstimate ??
                  "Acesso temporário"}
              </p>
              <dl>
                <div>
                  <dt>Acesso temporário</dt>
                  <dd>{product.duration ?? "Conforme produto"}</dd>
                </div>
                <div>
                  <dt>Entrega automática</dt>
                  <dd>Após confirmação e liberação</dd>
                </div>
                <div>
                  <dt>Pagamento</dt>
                  <dd>PIX</dd>
                </div>
                <div>
                  <dt>Entrega</dt>
                  <dd>Na própria tela</dd>
                </div>
                <div>
                  <dt>Suporte</dt>
                  <dd>WhatsApp BancadaSoft</dd>
                </div>
              </dl>
              <div className="summary-total">
                <span>TOTAL</span>
                <strong>
                  {money(order?.totalCents ?? selectedVariant?.priceCents ?? product.priceCents ?? 0)}
                </strong>
              </div>
            </aside>
          </div>
        </dialog>
      )}
    </>
  );
}
