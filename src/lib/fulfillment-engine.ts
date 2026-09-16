import {
  FulfillmentStatus,
  OrderStatus,
  Prisma,
  ProviderIntegrationStatus,
  ProviderOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolvePurchasedProviderProduct } from "@/lib/product-variants";
import { resolveProviderAdapter } from "@/lib/providers/registry";
import { ProviderOrderUncertainError } from "@/lib/providers/types";
import { adcleanConfigured } from "@/lib/providers/adclean";
import { sendDeliveryEmail } from "@/lib/notifications/delivery-email";
import {
  buildProviderExecutionPayload,
  MAX_PROVIDER_ATTEMPTS,
  providerOutcome,
  shouldRecordPaidFulfillmentFailure,
  validateProviderExecution,
} from "@/lib/fulfillment-rules";

export class FulfillmentEngineError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "FulfillmentEngineError";
  }
}

// Um pagamento já confirmado nunca pode ficar sem nenhum registro de Fulfillment
// visível no Admin — nem quando a pré-validação bloqueia a execução antes do
// provider, nem quando a própria transação que criaria o Fulfillment/ProviderOrder
// falha e sofre rollback (ex.: erro de banco durante a reserva do slot). upsert()
// torna a escrita idempotente-segura mesmo se chamada mais de uma vez.
async function recordPaidFulfillmentFailure(
  orderId: string,
  providerCode: string | undefined,
) {
  await prisma.$transaction([
    prisma.fulfillment.upsert({
      where: { orderId },
      update: {},
      create: {
        orderId,
        provider: providerCode ?? "unknown",
        status: FulfillmentStatus.FAILED,
      },
    }),
    prisma.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.FAILED,
        events: {
          create: {
            status: OrderStatus.FAILED,
            note: "Não foi possível iniciar a liberação automática. Nossa equipe pode revisar o pedido.",
          },
        },
      },
    }),
  ]);
}

export async function executeFulfillment(
  orderId: string,
  { retry = false }: { retry?: boolean } = {},
) {
  const [order, settings] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payment: true,
        fulfillment: {
          include: {
            providerOrders: {
              include: { callbackEvents: { select: { id: true } } },
            },
          },
        },
        items: {
          include: {
            providerProduct: { include: { provider: true } },
            product: {
              include: { providerProducts: { include: { provider: true } } },
            },
          },
        },
      },
    }),
    prisma.siteSettings.findUnique({
      where: { id: "default" },
      select: { providerMode: true },
    }),
  ]);
  if (!order) throw new FulfillmentEngineError("ORDER_NOT_FOUND");
  const purchasedProviderProduct = order.items[0]?.providerProduct;
  const links = purchasedProviderProduct
    ? [purchasedProviderProduct]
    : order.items.flatMap((item) => item.product.providerProducts);
  const resolution = resolvePurchasedProviderProduct(
    purchasedProviderProduct,
    links,
    settings?.providerMode ?? "TEST",
  );
  const selected = resolution.providerProduct;
  const existing = order.fulfillment?.providerOrders[0];
  const error = validateProviderExecution(
    {
      orderExists: true,
      paymentStatus: order.payment?.status,
      orderStatus: order.status,
      hasProviderProduct: !!selected,
      providerActive: !!selected?.provider.active,
      providerConnected:
        selected?.provider.code === "adclean"
          ? adcleanConfigured()
          : selected?.provider.integrationStatus ===
            ProviderIntegrationStatus.CONNECTED,
      providerOrderStatus: existing?.status,
      attempts: existing?.attempts ?? 0,
      hasDelivery: !!order.fulfillment?.delivery,
      externalOrderId: existing?.externalOrderId,
      requestReference: existing?.requestReference,
      hasCallback: Boolean(existing?.callbackEvents.length),
      resultUncertain: existing?.lastError === "PROVIDER_RESULT_UNCERTAIN",
    },
    retry,
  );
  if (error) {
    const code =
      resolution.status === "AMBIGUOUS"
        ? "PROVIDER_CONFIGURATION_AMBIGUOUS"
        : error;
    if (
      !retry &&
      !order.fulfillment &&
      shouldRecordPaidFulfillmentFailure(code, order.payment?.status)
    ) {
      // Pagamento confirmado, mas a execução foi bloqueada antes de chamar o
      // provider (ex.: produto/provider ficou indisponível nesse intervalo).
      await recordPaidFulfillmentFailure(
        orderId,
        purchasedProviderProduct?.provider.code,
      );
    }
    throw new FulfillmentEngineError(code);
  }
  if (!selected) throw new FulfillmentEngineError("PROVIDER_PRODUCT_NOT_FOUND");
  const adapter = resolveProviderAdapter(selected.provider.code);
  if (!adapter)
    throw new FulfillmentEngineError("PROVIDER_ADAPTER_UNAVAILABLE");
  let prepared;
  try {
    prepared = await prisma.$transaction(async (tx) => {
      const fulfillment = await tx.fulfillment.upsert({
        where: { orderId },
        update: {},
        create: {
          orderId,
          provider: selected.provider.code,
          status: FulfillmentStatus.QUEUED,
        },
      });
      const providerOrder = await tx.providerOrder.upsert({
        where: { fulfillmentId: fulfillment.id },
        update: {},
        create: {
          providerId: selected.providerId,
          providerProductId: selected.id,
          orderId,
          fulfillmentId: fulfillment.id,
          costCents: selected.providerCostCents,
          currency: selected.currency,
        },
      });
      const claim = await tx.providerOrder.updateMany({
        where: {
          id: providerOrder.id,
          status: retry ? ProviderOrderStatus.FAILED : ProviderOrderStatus.QUEUED,
          attempts: { lt: MAX_PROVIDER_ATTEMPTS },
        },
        data: {
          status: ProviderOrderStatus.PROCESSING,
          attempts: { increment: 1 },
          lastError: null,
          requestReference: providerOrder.id,
        },
      });
      if (claim.count !== 1)
        throw new FulfillmentEngineError("CONCURRENT_OR_INVALID_EXECUTION");
      await tx.fulfillment.update({
        where: { id: fulfillment.id },
        data: { status: FulfillmentStatus.PROCESSING },
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.PROCESSING,
          events: {
            create: {
              status: OrderStatus.PROCESSING,
              note: retry
                ? "Retry manual de provider iniciado."
                : "Execução do provider iniciada.",
            },
          },
        },
      });
      return providerOrder;
    });
  } catch (prepareError) {
    // Qualquer falha aqui (inclusive um erro de banco inesperado) desfaz por
    // inteiro o upsert de Fulfillment/ProviderOrder feito acima nesta mesma
    // transação — sem este catch, um Payment PAID podia ficar sem NENHUM
    // registro de Fulfillment e sem nenhum log (ver commerce.ts). CONCURRENT_
    // OR_INVALID_EXECUTION é o único caso que não é uma falha real: outra
    // execução já reivindicou/está processando este ProviderOrder.
    if (
      !(
        prepareError instanceof FulfillmentEngineError &&
        prepareError.code === "CONCURRENT_OR_INVALID_EXECUTION"
      )
    ) {
      await recordPaidFulfillmentFailure(orderId, selected.provider.code);
    }
    throw prepareError;
  }
  try {
    const operationalProvider = await prisma.provider.findUnique({
      where: { id: selected.providerId },
      select: { active: true },
    });
    if (!operationalProvider?.active)
      throw new FulfillmentEngineError("PROVIDER_INACTIVE");
    const result = await adapter.createOrder({
      providerProductId: selected.externalProductId,
      reference: prepared.id,
      payload: buildProviderExecutionPayload(
        orderId,
        order.items[0]?.unitPriceCents,
        (order.items[0]?.providerFields as Record<string, string | number> | null) ?? {},
      ),
    });
    const outcome = providerOutcome(result.status, result.delivery);
    if (outcome.deliver) {
      await prisma.$transaction([
        prisma.providerOrder.update({
          where: { id: prepared.id },
          data: {
            status: ProviderOrderStatus.COMPLETED,
            externalOrderId: result.externalOrderId,
            responseReference: result.reference,
          },
        }),
        prisma.fulfillment.update({
          where: { orderId },
          data: {
            status: FulfillmentStatus.FULFILLED,
            delivery: result.delivery as Prisma.InputJsonValue,
          },
        }),
        prisma.order.update({
          where: { id: orderId },
          data: {
            status: OrderStatus.DELIVERED,
            events: {
              create: [
                {
                  status: OrderStatus.FULFILLED,
                  note: "Provider concluído com sucesso.",
                },
                {
                  status: OrderStatus.DELIVERED,
                  note: "Entrega disponibilizada.",
                },
              ],
            },
          },
        }),
      ]);
      await sendDeliveryEmail(orderId).catch(() => undefined);
      return { status: "COMPLETED" as const };
    }
    if (result.status === "PROCESSING") {
      await prisma.providerOrder.update({
        where: { id: prepared.id },
        data: {
          ...(result.externalOrderId
            ? { externalOrderId: result.externalOrderId }
            : {}),
          status: ProviderOrderStatus.PROCESSING,
          responseReference: result.reference,
        },
      });
      return { status: "PROCESSING" as const };
    }
    throw new FulfillmentEngineError(result.error ?? "PROVIDER_FAILED");
  } catch (cause) {
    if (cause instanceof ProviderOrderUncertainError) {
      await prisma.providerOrder.update({
        where: { id: prepared.id },
        data: {
          status: ProviderOrderStatus.PROCESSING,
          lastError: "PROVIDER_RESULT_UNCERTAIN",
        },
      });
      return { status: "PROCESSING" as const };
    }
    const message = cause instanceof Error ? cause.message : "PROVIDER_FAILED";
    await prisma.$transaction([
      prisma.providerOrder.update({
        where: { id: prepared.id },
        data: { status: ProviderOrderStatus.FAILED, lastError: message },
      }),
      prisma.fulfillment.update({
        where: { orderId },
        data: { status: FulfillmentStatus.FAILED },
      }),
      prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.FAILED,
          events: {
            create: {
              status: OrderStatus.FAILED,
              note: "Não foi possível concluir a liberação automática. Nossa equipe pode revisar o pedido.",
            },
          },
        },
      }),
    ]);
    throw cause;
  }
}
