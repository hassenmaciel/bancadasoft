import {
  DeliveryType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProviderMode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog";
import { executeFulfillment, safeErrorInfo } from "@/lib/fulfillment-engine";
import {
  configuredPaymentProviderCode,
  getPaymentProvider,
} from "@/lib/payments/registry";
import {
  isPaidAfterExpiry,
  paymentWebhookLookup,
  shouldProcessPaymentEvent,
  shouldStartFulfillment,
  transitionPayment,
} from "@/lib/payments/rules";
import type { ParsedPaymentWebhook } from "@/lib/payments/types";
import {
  PaymentProviderNotConnectedError,
  PixPaymentReconciliationRequiredError,
} from "@/lib/payments/types";
import { AsaasClientError } from "@/lib/payments/asaas-client";
import { createDeliveryAccess } from "@/lib/guest-delivery";
import { reconcilePendingPixPayment } from "@/lib/payment-reconciliation";
import { resolveProviderProduct } from "@/lib/providers/selection";
import { resolveCheckoutVariant } from "@/lib/product-variants";
import { validateDynamicFieldValues, type DynamicField } from "@/lib/providers/automation";
import {
  digitsOnly,
  isValidCpf,
  isValidWhatsapp,
  normalizeWhatsapp,
} from "@/lib/checkout-validation";
import { assertCheckoutPrice } from "@/lib/commercial-pricing";
import { pixExpiresAt } from "@/lib/payments/pix-expiry";
import { expirePixIfDue } from "@/lib/payment-expiry";
import { TERMINAL_ORDER_STATUSES } from "@/lib/order-polling";
import { resolveAuthenticatedCheckoutIdentity } from "@/lib/checkout-identity";

export const catalogue = () =>
  prisma.product.findMany({
    where: publicProductWhere,
    include: { category: true, brand: true, variants: { include: { providerProduct: { include: { provider: true } } } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
export const productsForAdmin = () =>
  prisma.product.findMany({
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
export const setProductAvailability = (id: string, available: boolean) =>
  prisma.product.update({ where: { id }, data: { available } });

async function retryPendingPixCheckout(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true, customer: true },
  });
  if (!order?.payment) throw new Error("CHECKOUT_PAYMENT_NOT_FOUND");
  if (order.payment.pixCode && order.payment.qrCode) return;
  if (order.payment.externalPaymentId) {
    await reconcilePendingPixPayment(order.id);
    const refreshed = await prisma.payment.findUnique({ where: { orderId } });
    if (!refreshed?.pixCode || !refreshed.qrCode)
      throw new Error("PIX_CHECKOUT_INCOMPLETE");
    return;
  }

  const provider = getPaymentProvider(order.payment.provider);
  if (!provider) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
  const pendingReference = `pending:${order.publicToken}`;
  const creatingReference = `creating:${order.publicToken}`;
  const claimed = await prisma.payment.updateMany({
    where: {
      id: order.payment.id,
      externalPaymentId: null,
      providerReference: pendingReference,
    },
    data: { providerReference: creatingReference },
  });
  if (claimed.count !== 1) throw new Error("PIX_CHECKOUT_IN_PROGRESS");

  try {
    const payment = await provider.createPixPayment({
      orderId: order.publicToken,
      amountCents: order.totalCents,
      expiresAt: order.payment.expiresAt,
      customer: {
        internalId: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        cpfCnpj: order.customer.cpfCnpj ?? undefined,
        mobilePhone: order.customer.whatsapp ?? undefined,
        externalCustomerId: order.customer.asaasCustomerId ?? undefined,
      },
    });
    await prisma.$transaction(async (tx) => {
      if (payment.externalCustomerId && !order.customer.asaasCustomerId)
        await tx.user.update({
          where: { id: order.customer.id },
          data: { asaasCustomerId: payment.externalCustomerId },
        });
      await tx.payment.update({
        where: { id: order.payment!.id },
        data: {
          providerReference: payment.externalPaymentId,
          externalPaymentId: payment.externalPaymentId,
          status: payment.status,
          pixCode: payment.pixCode,
          qrCode: payment.qrCode,
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PENDING_PAYMENT,
          note: `PIX ${provider.code} criado.`,
        },
      });
    });
  } catch (error) {
    if (error instanceof PixPaymentReconciliationRequiredError) {
      await prisma.$transaction(async (tx) => {
        if (error.externalCustomerId && !order.customer.asaasCustomerId)
          await tx.user.update({
            where: { id: order.customer.id },
            data: { asaasCustomerId: error.externalCustomerId },
          });
        await tx.payment.update({
          where: { id: order.payment!.id },
          data: {
            providerReference: error.externalPaymentId,
            externalPaymentId: error.externalPaymentId,
          },
        });
      });
    } else if (
      error instanceof PaymentProviderNotConnectedError ||
      (error instanceof AsaasClientError && error.status !== null && error.status < 500)
    ) {
      await prisma.payment.updateMany({
        where: { id: order.payment.id, providerReference: creatingReference },
        data: { providerReference: pendingReference },
      });
    }
    throw error;
  }
}

// "Gerar novo PIX": reaproveita a MESMA Order e a MESMA linha de Payment
// (Payment.orderId é único). O reset só acontece para quem vence o claim
// atômico EXPIRED -> PENDING; a criação da cobrança reaproveita o claim
// pending -> creating de retryPendingPixCheckout. Cliques repetidos ou
// concorrentes resultam em no máximo uma nova cobrança.
export async function renewPixPayment(orderId: string) {
  await expirePixIfDue(orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
  if (!order?.payment) throw new Error("CHECKOUT_PAYMENT_NOT_FOUND");
  if (order.status !== OrderStatus.PENDING_PAYMENT)
    throw new Error("PIX_RENEW_NOT_ALLOWED");
  const payment = order.payment;
  if (payment.status === PaymentStatus.EXPIRED) {
    const reset = await prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.EXPIRED },
      data: {
        status: PaymentStatus.PENDING,
        providerReference: `pending:${order.publicToken}`,
        externalPaymentId: null,
        pixCode: "",
        qrCode: null,
        expiresAt: pixExpiresAt(),
      },
    });
    if (reset.count === 1)
      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PENDING_PAYMENT,
          note: `Novo PIX solicitado${payment.externalPaymentId ? ` (cobrança anterior ${payment.externalPaymentId})` : ""}.`,
        },
      });
  } else if (payment.status !== PaymentStatus.PENDING) {
    throw new Error("PIX_RENEW_NOT_ALLOWED");
  }
  await retryPendingPixCheckout(order.id);
  return getOrder(order.id);
}

export async function createOrder(input: {
  productId: string;
  variantId?: string;
  name?: string;
  email?: string;
  whatsapp?: string;
  cpfCnpj?: string;
  deliveryAccessToken: string;
  providerFields?: Record<string, string>;
}, authenticatedUserId?: string) {
  const access = createDeliveryAccess(new Date(), input.deliveryAccessToken);
  const recovered = await prisma.order.findUnique({
    where: { deliveryTokenHash: access.tokenHash },
  });
  // Um pedido TERMINAL (DELIVERED/FAILED/CANCELLED) nunca deve bloquear uma nova
  // compra: apenas pedidos ainda ativos reutilizam o token para evitar cobrança
  // duplicada (ver PARTE 1/7 do checklist de recovery).
  if (recovered && !TERMINAL_ORDER_STATUSES.has(recovered.status)) {
    await retryPendingPixCheckout(recovered.id);
    return {
      order: await getOrder(recovered.id),
      deliveryAccessToken: access.token,
    };
  }
  const [product, settings, authenticatedUser] = await Promise.all([
    prisma.product.findFirst({
      where: { id: input.productId, ...publicProductWhere },
      include: {
        providerProducts: { include: { provider: true } },
        variants: { include: { providerProduct: { include: { provider: true } } } },
      },
    }),
    prisma.siteSettings.findUnique({
      where: { id: "default" },
      select: { providerMode: true },
    }),
    authenticatedUserId ? prisma.user.findFirst({ where: { id: authenticatedUserId, active: true } }) : null,
  ]);
  if (!product) return undefined;
  const providerMode = settings?.providerMode ?? ProviderMode.TEST;
  const variantResolution = resolveCheckoutVariant(
    product.variants,
    input.variantId,
    providerMode,
  );
  if (variantResolution && variantResolution.status !== "SELECTED") return undefined;
  const providerResolution = variantResolution
    ? { status: "SELECTED" as const, providerProduct: variantResolution.providerProduct }
    : resolveProviderProduct(product.providerProducts, providerMode);
  if (
    product.deliveryType === DeliveryType.AUTOMATIC &&
    providerResolution.status !== "SELECTED"
  )
    return undefined;
  const providerFields = providerResolution.providerProduct
    ? validateDynamicFieldValues(
        Array.isArray(providerResolution.providerProduct.fieldSchema)
          ? providerResolution.providerProduct.fieldSchema as unknown as DynamicField[]
          : [],
        input.providerFields,
      )
    : {};
  const viewer = authenticatedUser ? { customerTier: authenticatedUser.customerTier } : null;
  const unitPriceCents = assertCheckoutPrice(product, variantResolution?.variant ?? null, viewer);

  // PARTE 3/4: cliente autenticado usa a própria conta como fonte da
  // identidade (nome/e-mail nunca vêm do client); só os campos realmente
  // ausentes (CPF/WhatsApp) podem ser completados por este request, e só
  // esses campos são gravados no cadastro. Guest preserva o fluxo atual.
  let user: { id: string; name: string; email: string; asaasCustomerId: string | null };
  let cpfCnpj: string;
  let whatsapp: string;
  if (authenticatedUser) {
    const resolved = resolveAuthenticatedCheckoutIdentity(authenticatedUser, {
      cpfCnpj: input.cpfCnpj,
      whatsapp: input.whatsapp,
    });
    cpfCnpj = resolved.cpfCnpj;
    whatsapp = resolved.whatsapp;
    user = Object.keys(resolved.accountUpdates).length
      ? await prisma.user.update({
          where: { id: authenticatedUser.id },
          data: resolved.accountUpdates,
        })
      : authenticatedUser;
  } else {
    if (!input.name || !input.email || !input.cpfCnpj || !input.whatsapp)
      throw new Error("INVALID_CUSTOMER_DATA");
    cpfCnpj = digitsOnly(input.cpfCnpj);
    whatsapp = normalizeWhatsapp(input.whatsapp);
    if (!isValidCpf(cpfCnpj) || !isValidWhatsapp(whatsapp))
      throw new Error("INVALID_CUSTOMER_DATA");
    const customerEmail = input.email;
    const previousUser = await prisma.user.findUnique({
      where: { email: customerEmail },
      select: { cpfCnpj: true, asaasCustomerId: true },
    });
    const reusableAsaasCustomerId =
      previousUser?.cpfCnpj === cpfCnpj ? previousUser.asaasCustomerId : null;
    user = await prisma.user.upsert({
      where: { email: customerEmail },
      update: {
        name: input.name,
        cpfCnpj,
        whatsapp,
        asaasCustomerId: reusableAsaasCustomerId,
      },
      create: {
        email: customerEmail,
        name: input.name,
        cpfCnpj,
        whatsapp,
        passwordHash: "PENDING_INVITE",
      },
    });
  }
  const providerCode = configuredPaymentProviderCode();
  const provider = getPaymentProvider(providerCode);
  if (!provider) throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");
  const publicToken = crypto.randomUUID().replaceAll("-", "");
  const expiresAt = pixExpiresAt();
  const pendingOrder = await prisma.order.create({
    data: {
      publicToken,
      deliveryTokenHash: access.tokenHash,
      deliveryTokenExpiresAt: access.expiresAt,
      deliveryTokenEncrypted: access.encryptedToken,
      customerId: user.id,
      totalCents: unitPriceCents,
      items: {
        create: {
          productId: product.id,
          productVariantId: variantResolution?.variant.id,
          providerProductId: providerResolution.providerProduct?.id,
          unitPriceCents,
          providerFields,
        },
      },
      payment: {
        create: {
          provider: provider.code,
          providerReference: `pending:${publicToken}`,
          amountCents: unitPriceCents,
          status: PaymentStatus.PENDING,
          pixCode: "",
          expiresAt,
        },
      },
      events: {
        create: {
          status: OrderStatus.PENDING_PAYMENT,
          note: `Pagamento ${provider.code} em criação.`,
        },
      },
    },
    include: { payment: true },
  });
  let payment;
  try {
    payment = await provider.createPixPayment({
      orderId: publicToken,
      amountCents: unitPriceCents,
      expiresAt,
      customer: {
        internalId: user.id,
        name: user.name,
        email: user.email,
        cpfCnpj,
        mobilePhone: whatsapp,
        externalCustomerId: user.asaasCustomerId ?? undefined,
      },
    });
  } catch (error) {
    if (error instanceof PixPaymentReconciliationRequiredError) {
      await prisma.$transaction(async (tx) => {
        if (error.externalCustomerId && !user.asaasCustomerId)
          await tx.user.update({
            where: { id: user.id },
            data: { asaasCustomerId: error.externalCustomerId },
          });
        await tx.payment.update({
          where: { orderId: pendingOrder.id },
          data: {
            providerReference: error.externalPaymentId,
            externalPaymentId: error.externalPaymentId,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: pendingOrder.id,
            status: OrderStatus.PENDING_PAYMENT,
            note: `Cobrança ${provider.code} criada; PIX aguardando reconciliação.`,
          },
        });
      });
    }
    throw error;
  }
  await prisma.$transaction(async (tx) => {
    if (
      provider.code === "asaas" &&
      payment.externalCustomerId &&
      !user.asaasCustomerId
    )
      await tx.user.update({
        where: { id: user.id },
        data: { asaasCustomerId: payment.externalCustomerId },
      });
    await tx.payment.update({
      where: { orderId: pendingOrder.id },
      data: {
        providerReference: payment.externalPaymentId,
        externalPaymentId: payment.externalPaymentId,
        status: payment.status,
        pixCode: payment.pixCode,
        qrCode: payment.qrCode,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: pendingOrder.id,
        status: OrderStatus.PENDING_PAYMENT,
        note: `PIX ${provider.code} criado.`,
      },
    });
  });
  return {
    order: await getOrder(pendingOrder.id),
    deliveryAccessToken: access.token,
  };
}
export const getOrder = (id: string) =>
  prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: { include: { category: true, brand: true } },
          productVariant: { select: { id: true, name: true } },
        },
      },
      payment: true,
      fulfillment: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });


export async function processPayment(
  event: ParsedPaymentWebhook,
  log: (message: string, context: Record<string, unknown>) => void = (
    message,
    context,
  ) => console.error(message, context),
) {
  const lookup = paymentWebhookLookup(event);
  let payment = lookup.external
    ? await prisma.payment.findFirst({
        where: lookup.external,
        include: { order: true },
      })
    : null;
  if (!payment && lookup.reference)
    payment = await prisma.payment.findFirst({
      where: lookup.reference,
      include: { order: true },
    });
  if (!payment) return undefined;
  const existing = await prisma.paymentEvent.findUnique({
    where: { providerEventId: event.providerEventId },
  });
  if (!shouldProcessPaymentEvent(!!existing))
    return { duplicate: true, order: await getOrder(payment.orderId) };
  const nextStatus = transitionPayment(payment.status, event.status);
  const manualReview =
    isPaidAfterExpiry(payment.status, event.status) ||
    (event.status === PaymentStatus.PAID &&
      !!payment.externalPaymentId &&
      !!event.externalPaymentId &&
      payment.externalPaymentId !== event.externalPaymentId);
  const startFulfillment =
    payment.status !== PaymentStatus.PAID && shouldStartFulfillment(nextStatus);
  const paymentData = {
    status: nextStatus,
    ...(!payment.externalPaymentId && event.externalPaymentId
      ? {
          externalPaymentId: event.externalPaymentId,
          providerReference: event.externalPaymentId,
        }
      : {}),
  };
  try {
    if (startFulfillment) {
      await prisma.$transaction([
        prisma.paymentEvent.create({
          data: {
            providerEventId: event.providerEventId,
            paymentId: payment.id,
            payload: event.payload as Prisma.InputJsonValue,
          },
        }),
        prisma.payment.update({ where: { id: payment.id }, data: paymentData }),
        prisma.order.update({
          where: { id: payment.orderId },
          data: {
            status: OrderStatus.PAID,
            events: {
              create: {
                status: OrderStatus.PAID,
                note: manualReview
                  ? `Pagamento ${payment.provider} confirmado APÓS a expiração do PIX (ou de outra cobrança) — REVISÃO MANUAL necessária.`
                  : `Pagamento ${payment.provider} confirmado.`,
              },
            },
          },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.paymentEvent.create({
          data: {
            providerEventId: event.providerEventId,
            paymentId: payment.id,
            payload: event.payload as Prisma.InputJsonValue,
          },
        }),
        prisma.payment.update({ where: { id: payment.id }, data: paymentData }),
      ]);
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return { duplicate: true, order: await getOrder(payment.orderId) };
    throw error;
  }
  if (startFulfillment) {
    try {
      await executeFulfillment(payment.orderId);
    } catch (error) {
      // PAID permanece confirmado; a falha (com evidência FAILED persistida
      // pelo engine) precisa ficar visível em log para correlação com o
      // orderId — nunca deve ser descartada em silêncio.
      log("[fulfillment] Execução falhou após pagamento confirmado.", {
        orderId: payment.orderId,
        ...safeErrorInfo(error),
      });
    }
  }
  return { duplicate: false, order: await getOrder(payment.orderId) };
}
