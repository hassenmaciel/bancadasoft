"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryDTO, OrderDTO, ProductDTO } from "@/lib/dto";
import { isOptimizableImage } from "@/lib/image-source";
import type { CheckoutIdentitySummary } from "@/lib/checkout-identity";
import {
  createOrderPoller,
  isFailedCheckoutOrder,
  isRecoverableCheckoutOrder,
} from "@/lib/order-polling";
import CredentialDelivery from "@/components/credential-delivery";
import LicenseAccountConfirmation from "@/components/license-account-confirmation";
import {
  canSubmitCheckout,
  isUnlockToolLicense,
  LICENSE_DELIVERY_TITLE,
  licenseActivationMessage,
  providerFieldPresentation,
  showLicenseActivationMessage,
  summaryBadge,
} from "@/lib/unlocktool-license";
import PixPayment from "@/components/pix-payment";
import NewPurchaseButton from "@/components/new-purchase-button";
import { PIX_CANCEL_REVIEW_MESSAGE, clearStoredCheckout, showNewPurchaseButton } from "@/lib/new-purchase";
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

export default function CheckoutPanel({
  product,
  identity = null,
}: {
  product: ProductDTO;
  identity?: CheckoutIdentitySummary | null;
}) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<OrderDTO | null>(null);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState("");
  const renewGuard = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const cancelGuard = useRef(false);
  const [delivery, setDelivery] = useState<DeliveryDTO | null>(null);
  const [variantId, setVariantId] = useState(product.variants.length === 1 ? product.variants[0].id : "");
  // Fica true quando o polling entra na fase de espera (frequência reduzida,
  // ver src/lib/order-polling.ts) — o polling continua rodando, só que mais
  // devagar; isso NÃO é um erro/timeout de pagamento.
  const [pollSlowPhase, setPollSlowPhase] = useState(false);
  const [lastPolledOrderId, setLastPolledOrderId] = useState<string | null>(null);
  if ((order?.id ?? null) !== lastPolledOrderId) {
    setLastPolledOrderId(order?.id ?? null);
    setPollSlowPhase(false);
  }
  const submitGuard = useRef(createCheckoutSubmissionGuard());
  const modalRef = useRef<HTMLDialogElement | null>(null);
  const storageKey = `bancadasoft:checkout:${product.id}`;
  // Apresentação específica da licença UnlockTool; false para todo outro produto.
  const licenseMode = isUnlockToolLicense(product);
  // Conferência apenas no cliente: não é persistida nem enviada à API.
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const clearActiveCheckout = useCallback(
    () => clearStoredCheckout(localStorage, storageKey),
    [storageKey],
  );
  const paid = order?.payment?.status === "PAID";
  const delivered = order?.status === "DELIVERED" && !!delivery;
  // PARTE 5: pequena janela em que o pedido já está DELIVERED no backend mas
  // a Delivery ainda não voltou (ou uma tentativa falhou) — não deve mostrar
  // formulário nem a mensagem genérica de "liberando acesso".
  const deliveryPending = order?.status === "DELIVERED" && !delivery;
  // Cobre FAILED/CANCELLED e pagamento morto (EXPIRED/FAILED/REFUNDED) — nenhum
  // desses progride sozinho, então nenhum deles pode cair no PIX pendente nem
  // na mensagem de "liberando" abaixo.
  const failed = order ? isFailedCheckoutOrder(order) : false;
  const selectedVariant = product.variants.find((variant) => variant.id === variantId);
  const checkoutFields = selectedVariant?.checkoutFields ?? product.checkoutFields;
  // PARTE 1/3/4: cliente logado com cadastro completo pula o formulário;
  // com cadastro incompleto, só os campos realmente ausentes são pedidos.
  const needsCpf = identity?.missing.includes("cpfCnpj") ?? false;
  const needsWhatsapp = identity?.missing.includes("whatsapp") ?? false;

  // GET-only: nunca cria Order/Payment, nunca chama provider. Retorna se a
  // entrega foi obtida, para permitir retry com backoff (PARTE 5).
  const loadDelivery = useCallback(async (orderId: string) => {
    const token = localStorage.getItem(`bancadasoft:delivery:${orderId}`);
    if (!token) return false;
    const response = await fetch(`/api/orders/${orderId}/delivery`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const payload = await response.json();
    if (!payload.data.delivery) return false;
    setDelivery(payload.data.delivery);
    return true;
  }, []);
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
        // Fonte da verdade é o estado do pedido no banco: um pedido realmente
        // terminal (FAILED/CANCELLED, ou pagamento expirado/falho/reembolsado)
        // nunca reabre o checkout automaticamente nesta página — apenas o
        // recovery explícito (link/e-mail) faz isso. DELIVERED é diferente: é
        // terminal para fins de polling, mas continua recuperável — o cliente
        // que volta à página do produto deve ver a entrega já pronta, não o
        // formulário de compra de novo.
        if (!isRecoverableCheckoutOrder(payload.data)) {
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
  // fetchOrder lê sempre o order/token mais recentes via ref: o efeito abaixo
  // depende só de order?.id, não do objeto inteiro, para que o poller NÃO seja
  // recriado (e seu cronômetro de timeout reiniciado) a cada atualização.
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  useEffect(() => {
    if (!order) return;
    const poller = createOrderPoller({
      initialOrder: order,
      fetchOrder: async () => {
        const current = orderRef.current!;
        const response = await fetch(
          `/api/orders/${current.id}?token=${encodeURIComponent(current.publicToken)}`,
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
        // Assim que o pedido deixa de ser recuperável (FAILED/CANCELLED), a
        // referência de "checkout ativo" deste produto é esquecida — uma nova
        // visita à página não deve reabri-lo. DELIVERED continua recuperável
        // (ver isRecoverableCheckoutOrder), então a referência é preservada
        // para que voltar à página ainda mostre a entrega já pronta. A busca
        // da Delivery em si é responsabilidade só do efeito de carregamento
        // abaixo (dispara sozinho ao ver DELIVERED sem delivery carregada).
        if (!isRecoverableCheckoutOrder(updated)) clearActiveCheckout();
      },
      onSlowPhase: () => setPollSlowPhase(true),
    });
    poller.start();
    return poller.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, clearActiveCheckout]);
  // PARTE 4/5: DELIVERED é a fonte principal — assim que o pedido chega (ou é
  // restaurado) nesse estado e ainda não temos a Delivery carregada nesta
  // sessão (restore, transição ao vivo do polling, ou falha transitória
  // anterior), este é o único efeito responsável por buscá-la. Só leitura
  // (GET), nunca cria Order/Payment nem chama provider; tenta novamente com
  // backoff curto e limitado em vez de exigir F5 ou depender do e-mail.
  useEffect(() => {
    if (!order || order.status !== "DELIVERED" || delivery) return;
    const orderId = order.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const backoffMs = [0, 1500, 3000, 6000];
    let step = 0;
    const attempt = async () => {
      if (cancelled) return;
      const ok = await loadDelivery(orderId);
      if (cancelled || ok) return;
      if (step < backoffMs.length - 1) {
        step += 1;
        timer = setTimeout(attempt, backoffMs[step]);
      }
    };
    timer = setTimeout(attempt, backoffMs[step]);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [order, delivery, loadDelivery]);

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (licenseMode && !accountConfirmed) return;
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
      // Cliente logado: nome/e-mail nunca são enviados (a conta autenticada é
      // a fonte); CPF/WhatsApp só são enviados quando ainda faltam na conta.
      const identityFields = identity
        ? {
            ...(needsCpf
              ? { cpfCnpj: String(form.get("cpfCnpj") ?? "").replace(/\D/g, "") }
              : {}),
            ...(needsWhatsapp ? { whatsapp: form.get("whatsapp") } : {}),
          }
        : {
            name: form.get("name"),
            email: form.get("email"),
            whatsapp: form.get("whatsapp"),
            cpfCnpj: String(form.get("cpfCnpj") ?? "").replace(/\D/g, ""),
          };
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          variantId: product.variants.length ? variantId : undefined,
          ...identityFields,
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
  // "Gerar novo PIX": um clique = no máximo uma requisição em voo; o servidor
  // ainda garante uma única cobrança nova mesmo com cliques concorrentes.
  async function renewPix() {
    if (!order || renewGuard.current) return;
    renewGuard.current = true;
    setRenewing(true);
    setRenewError("");
    try {
      const response = await fetch(
        `/api/orders/${order.id}/pix?token=${encodeURIComponent(order.publicToken)}`,
        { method: "POST", cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data)
        throw new Error(payload?.error ?? "Não foi possível gerar um novo PIX agora.");
      setOrder(payload.data);
    } catch (cause) {
      setRenewError(cause instanceof Error ? cause.message : "Não foi possível gerar um novo PIX agora.");
    } finally {
      renewGuard.current = false;
      setRenewing(false);
    }
  }
  // "Cancelar e começar de novo": o servidor força a expiração pelo fluxo existente
  // (no máximo um cancelamento no provedor). Se o provedor não confirmou, o pedido
  // vira "PIX expirado" com aviso e a referência local é mantida; caso contrário
  // esquece o pedido deste produto e volta ao primeiro passo do checkout.
  async function cancelPix() {
    if (!order || cancelGuard.current) return;
    cancelGuard.current = true;
    setCancelling(true);
    setCancelMessage("");
    try {
      const response = await fetch(
        `/api/orders/${order.id}/cancel-pix?token=${encodeURIComponent(order.publicToken)}`,
        { method: "POST", cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data)
        throw new Error(payload?.error ?? "Não foi possível cancelar o PIX agora.");
      if (payload.manualReview) {
        setOrder(payload.data);
        setCancelMessage(PIX_CANCEL_REVIEW_MESSAGE);
      } else {
        startNewPurchase();
      }
    } catch (cause) {
      setCancelMessage(cause instanceof Error ? cause.message : "Não foi possível cancelar o PIX agora.");
    } finally {
      cancelGuard.current = false;
      setCancelling(false);
    }
  }
  function close() {
    if (submitting) return;
    // X fecha apenas a experiência visual atual. Pedidos recuperáveis (ainda
    // ativos, ou já DELIVERED) preservam order/delivery em memória e a
    // referência no localStorage — reabrir pelo CTA do produto volta a mostrar
    // exatamente o mesmo estado, sem precisar consultar o servidor de novo.
    // Em qualquer outro caso (sem pedido, ou pedido realmente não recuperável
    // — FAILED/CANCELLED) o estado visual é resetado, liberando uma compra
    // nova deste produto; a referência local só é apagada quando havia de
    // fato um pedido não recuperável (um token pré-pedido ainda sem Order
    // associada, salvo antes do POST /api/checkout, continua preservado para
    // a idempotência de retry).
    const recoverable = order ? isRecoverableCheckoutOrder(order) : false;
    if (order && !recoverable) clearActiveCheckout();
    if (!recoverable) {
      setOrder(null);
      setNotice("");
      setCopied(false);
      setDelivery(null);
    }
    setOpen(false);
  }
  // Permite explicitamente iniciar uma nova compra do mesmo produto mesmo
  // havendo uma entrega anterior já concluída — sem transformar o DELIVERED
  // antigo em bloqueio permanente e sem tocar no schema/idempotência do
  // servidor: só esquece a referência local, então o próximo checkout() gera
  // um deliveryAccessToken novo em vez de reutilizar o token já vinculado ao
  // pedido anterior (evitaria colisão do deliveryTokenHash único no banco).
  function startNewPurchase() {
    clearActiveCheckout();
    setOrder(null);
    setDelivery(null);
    setNotice("");
    setCopied(false);
    setCancelMessage("");
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
          <div className={licenseMode ? "checkout-shell checkout-shell--license" : "checkout-shell"}>
            <section className="checkout-main">
              {!order ? (
                <form
                  className="checkout-form"
                  onSubmit={checkout}
                  noValidate={false}
                >
                  <span className="checkout-kicker">✓ Checkout seguro</span>
                  <h2 id="checkout-title">Finalize sua compra</h2>
                  {identity ? (
                    <>
                      <p className="checkout-lead">
                        {identity.complete
                          ? "Confirme seus dados e gere o PIX."
                          : "Complete os dados abaixo para continuar."}
                      </p>
                      <div className="checkout-identity-summary">
                        <span>Comprando como</span>
                        <b>{identity.name}</b>
                        <small>{identity.maskedEmail}</small>
                        {identity.maskedCpf && <small>CPF {identity.maskedCpf}</small>}
                        {identity.maskedWhatsapp && <small>WhatsApp {identity.maskedWhatsapp}</small>}
                      </div>
                    </>
                  ) : (
                    <p className="checkout-lead">
                      Preencha seus dados para gerar o PIX.
                      <br />
                      Não é necessário criar uma conta.
                    </p>
                  )}
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
                    {!identity && (
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
                    )}
                    {(!identity || needsCpf) && (
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
                    )}
                    {!identity && (
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
                    )}
                    {(!identity || needsWhatsapp) && (
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
                    )}
                    {checkoutFields.map((field) => {
                      const presentation = providerFieldPresentation(licenseMode, field);
                      return (
                      <label key={field.key} htmlFor={`checkout-provider-${field.key}`}>
                        {presentation.label}
                        {field.type === "textarea" ? (
                          <textarea
                            id={`checkout-provider-${field.key}`}
                            name={`provider:${field.key}`}
                            placeholder={presentation.placeholder}
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
                            placeholder={presentation.placeholder}
                            required={field.required}
                            minLength={field.validation?.minLength}
                            maxLength={field.validation?.maxLength}
                            pattern={field.validation?.pattern}
                            autoComplete="off"
                          />
                        )}
                        {presentation.help && <small className="field-help">{presentation.help}</small>}
                      </label>
                      );
                    })}
                    {licenseMode && (
                      <LicenseAccountConfirmation
                        checked={accountConfirmed}
                        onChange={setAccountConfirmed}
                      />
                    )}
                  </div>
                  {notice && (
                    <p className="checkout-error" role="alert">
                      {notice}
                    </p>
                  )}
                  <button
                    className="checkout-submit"
                    disabled={!canSubmitCheckout({ licenseMode, confirmed: accountConfirmed, submitting })}
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
                      <h2 id="checkout-title">{licenseMode ? LICENSE_DELIVERY_TITLE : "Acesso liberado"}</h2>
                      <div className="progress-checks">
                        <span>✓ Pagamento confirmado</span>
                        <span>✓ Liberação concluída</span>
                      </div>
                      {!licenseMode && <p>Seu acesso está pronto para uso.</p>}
                      <CredentialDelivery {...delivery} licenseActivation={licenseMode} />
                      {product.downloadUrl && (
                        <a
                          className="access-tool-cta"
                          href={product.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {product.downloadLabel || "ACESSAR FERRAMENTA"}
                        </a>
                      )}
                      {showNewPurchaseButton(order.status, !!delivery) && (
                        <NewPurchaseButton onClick={startNewPurchase} />
                      )}
                      {!licenseMode && (
                        <p className="checkout-guidance">
                          Guarde essas informações até finalizar o período de uso.
                        </p>
                      )}
                      <p className="email-note">
                        Também enviamos um link de recuperação para seu e-mail.
                      </p>
                    </>
                  ) : deliveryPending ? (
                    <>
                      <span className="state-icon state-success">✓</span>
                      <span className="checkout-kicker">Pagamento confirmado</span>
                      <h2 id="checkout-title">Seu acesso foi liberado</h2>
                      <div className="processing-line">
                        <span />
                        <span />
                        <span />
                      </div>
                      <p>Estamos carregando os dados da entrega...</p>
                      <button
                        type="button"
                        className="new-purchase-link"
                        onClick={() => void loadDelivery(order.id)}
                      >
                        Tentar novamente
                      </button>
                    </>
                  ) : failed ? (
                    <>
                      <span className="state-icon state-wait">!</span>
                      <h2 id="checkout-title">
                        Não foi possível concluir a liberação automaticamente
                      </h2>
                      <p>
                        O pagamento permanece registrado. Não faça um novo
                        pagamento. Nossa equipe pode verificar este pedido.
                      </p>
                    </>
                  ) : showLicenseActivationMessage({ licenseMode, paid, orderStatus: order.status }) ? (
                    <>
                      <span className="state-icon state-success">✓</span>
                      <h2 id="checkout-title">Ativando sua licença</h2>
                      <p>{licenseActivationMessage(product.deliveryEstimate)}</p>
                    </>
                  ) : paid && pollSlowPhase ? (
                    <>
                      <span className="state-icon state-success">✓</span>
                      <span className="checkout-kicker">
                        Pagamento confirmado
                      </span>
                      <h2 id="checkout-title">
                        Estamos concluindo a liberação do seu acesso
                      </h2>
                      <p>
                        Seu pagamento foi confirmado. A liberação automática
                        está demorando mais do que o normal, mas seu pedido
                        continua sendo processado — não é necessário pagar
                        novamente.
                      </p>
                      <p className="checkout-guidance">
                        Você pode atualizar esta página em alguns instantes ou
                        acompanhar o andamento pela página de pedido abaixo.
                        Se precisar, fale com o suporte.
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
                      {order.payment ? (
                        <PixPayment
                          key={order.payment.serverTime}
                          payment={order.payment}
                          amountLabel={money(order.payment.amountCents)}
                          copied={copied}
                          onCopy={copyPix}
                          onRenew={renewPix}
                          renewing={renewing}
                          renewError={renewError}
                          orderStatus={order.status}
                          onCancel={cancelPix}
                          cancelling={cancelling}
                          cancelMessage={cancelMessage}
                          onNewPurchase={startNewPurchase}
                        />
                      ) : (
                        <>
                          <span className="checkout-kicker">Pagamento via PIX</span>
                          <h2 id="checkout-title">Aguardando pagamento</h2>
                        </>
                      )}
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
                    unoptimized={!isOptimizableImage(product.imageUrl)}
                    loading="lazy"
                  />
                ) : (
                  <b>{product.name.slice(0, 2).toUpperCase()}</b>
                )}
              </div>
              <span className="summary-type">
                {summaryBadge(licenseMode, product.type)}
              </span>
              <h3>{product.name}</h3>
              {licenseMode ? (
                (product.duration ?? product.deliveryEstimate) && (
                  <p>{product.duration ?? product.deliveryEstimate}</p>
                )
              ) : (
                <p>
                  {product.duration ??
                    product.deliveryEstimate ??
                    "Acesso temporário"}
                </p>
              )}
              <dl>
                {licenseMode ? (
                  product.duration && (
                    <div>
                      <dt>Validade</dt>
                      <dd>{product.duration}</dd>
                    </div>
                  )
                ) : (
                  <div>
                    <dt>Acesso temporário</dt>
                    <dd>{product.duration ?? "Conforme produto"}</dd>
                  </div>
                )}
                <div>
                  <dt>Entrega automática</dt>
                  <dd>Após confirmação e liberação</dd>
                </div>
                <div>
                  <dt>Pagamento</dt>
                  <dd>PIX</dd>
                </div>
                {licenseMode ? (
                  product.deliveryEstimate && (
                    <div>
                      <dt>Entrega</dt>
                      <dd>{product.deliveryEstimate}</dd>
                    </div>
                  )
                ) : (
                  <div>
                    <dt>Entrega</dt>
                    <dd>Na própria tela</dd>
                  </div>
                )}
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
