import {
  DeliveryType,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProviderMode,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog";
import { executeFulfillment } from "@/lib/fulfillment-engine";
import {
  configuredPaymentProviderCode,
  getPaymentProvider,
} from "@/lib/payments/registry";
import {
  paymentWebhookLookup,
  shouldProcessPaymentEvent,
  shouldStartFulfillment,
  transitionPayment,
} from "@/lib/payments/rules";
import type { ParsedPaymentWebhook } from "@/lib/payments/types";
import { PixPaymentReconciliationRequiredError } from "@/lib/payments/types";
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
    await reconcilePendingPixPayment(recovered.id);
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
  const expiresAt = new Date(Date.now() + 900000);
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
        expiresAt: payment.expiresAt,
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

export async function processPayment(event: ParsedPaymentWebhook) {
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
                note: `Pagamento ${payment.provider} confirmado.`,
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
    } catch {
      /* PAID remains committed; fulfillment failure is persisted by the engine */
    }
  }
  return { duplicate: false, order: await getOrder(payment.orderId) };
}
