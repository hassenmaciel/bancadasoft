import {
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  Prisma,
  ProviderIntegrationStatus,
  ProviderOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolvePurchasedProviderProduct } from "@/lib/product-variants";
import { resolveProviderAdapter } from "@/lib/providers/registry";
import { ProviderOrderUncertainError } from "@/lib/providers/types";
import type { ProviderOrderResult } from "@/lib/providers/types";
import { adcleanConfigured } from "@/lib/providers/adclean";
import { sendDeliveryEmail } from "@/lib/notifications/delivery-email";
import {
  buildProviderExecutionPayload,
  classifyFulfillmentRecovery,
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

// Formato sanitizado para logs server-side: nunca inclui payload/segredo, só
// nome do erro + código + (quando aplicável) o código Prisma sanitizado
// (ex.: "P2002"). Usado tanto aqui quanto em commerce.ts (importado de lá) —
// nos dois pedidos reais investigados em 17/09/2026, o log só mostrava
// "FULFILLMENT_INTERNAL_ERROR" sem o código Prisma real, o que não foi
// suficiente para diagnosticar a causa (seção 17 da tarefa).
export function safeErrorInfo(error: unknown) {
  if (error instanceof FulfillmentEngineError)
    return { name: error.name, code: error.code };
  if (error instanceof Prisma.PrismaClientKnownRequestError)
    return { name: error.name, code: "FULFILLMENT_INTERNAL_ERROR", prismaCode: error.code };
  if (error instanceof Error)
    return { name: error.name, code: "FULFILLMENT_INTERNAL_ERROR" };
  return { name: "UnknownError", code: "FULFILLMENT_INTERNAL_ERROR" };
}

type PrepareConflictResolution = "SAFE_CONCURRENT" | "REAL_ERROR";

// Decide se um erro na transação de "prepare" de executeFulfillment é um
// conflito de concorrência legítimo (outra execução para o MESMO pedido
// reivindicou o slot ao mesmo tempo) ou um erro real que precisa ser
// registrado como falha. NUNCA generaliza — P2002/P2034 só são aceitos como
// concorrência segura quando (a) a constraint violada é exatamente a que o
// claim usa, e (b) uma releitura do banco confirma que um Fulfillment
// realmente existe agora para este pedido (prova objetiva, não suposição).
async function classifyPrepareConflict(
  orderId: string,
  prepareError: unknown,
): Promise<PrepareConflictResolution> {
  if (
    prepareError instanceof FulfillmentEngineError &&
    prepareError.code === "CONCURRENT_OR_INVALID_EXECUTION"
  ) {
    // Já provado atomicamente pelo claim() (updateMany com count !== 1) —
    // não precisa reler nada, essa checagem já É a prova.
    return "SAFE_CONCURRENT";
  }
  if (!(prepareError instanceof Prisma.PrismaClientKnownRequestError))
    return "REAL_ERROR";
  if (prepareError.code !== "P2002" && prepareError.code !== "P2034")
    return "REAL_ERROR";
  if (prepareError.code === "P2002") {
    // Não generalizar todo P2002 do sistema: só aceita como concorrência
    // legítima quando a constraint violada é a que o claim de fato usa
    // (Fulfillment.orderId ou ProviderOrder.fulfillmentId). Qualquer outra
    // constraint é tratada como erro real (caso 5 da auditoria).
    const target = JSON.stringify(prepareError.meta?.target ?? "").toLowerCase();
    const isExpectedConstraint =
      target.includes("orderid") || target.includes("fulfillmentid");
    if (!isExpectedConstraint) return "REAL_ERROR";
  }
  // P2034 (write conflict/deadlock) só pode ocorrer aqui, dentro da própria
  // transação de prepare — nenhuma chamada externa (adapter.createOrder)
  // aconteceu ainda neste ponto, então não há risco de duplicar efeito
  // comercial. Mesmo assim, confirmamos objetivamente com uma releitura: a
  // garantia de unique constraint nessas colunas significa que, se o
  // conflito for legítimo, uma linha concorrente já existe agora.
  const persisted = await prisma.fulfillment.findUnique({
    where: { orderId },
    select: { id: true },
  });
  return persisted ? "SAFE_CONCURRENT" : "REAL_ERROR";
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

// Finalização compartilhada por executeFulfillment (1ª tentativa/retry) e por
// reconcileFulfillment (consulta pós-incerteza): garante exatamente uma
// Delivery mesmo sob duas chamadas concorrentes.
//
// IMPORTANTE (revisão pós-implementação): o claim (updateMany do ProviderOrder
// com guarda `status != COMPLETED`) e a transição de Fulfillment/Order para
// DELIVERED precisam estar na MESMA transação — nunca em duas chamadas
// separadas ao banco. Duas chamadas separadas reabririam exatamente a janela
// que a versão original (tudo num único $transaction([...])) não tinha: um
// crash/erro entre as duas deixaria ProviderOrder=COMPLETED com Fulfillment/
// Order ainda em PROCESSING, e nada mais tentaria concluir essa transição
// depois (reconcileFulfillment nem chega a rodar de novo, porque o estado já
// não bate mais com "existe ProviderOrder pendente para reconciliar" da forma
// esperada). Por isso o claim usa uma transação INTERATIVA: guarda e
// finalização são atômicas juntas, e só a chamada que realmente reivindicar o
// ProviderOrder grava Fulfillment/Order — a outra vira no-op idempotente.
async function finalizeProviderCompletion(
  orderId: string,
  providerOrderId: string,
  result: Pick<ProviderOrderResult, "externalOrderId" | "reference"> & {
    delivery: Record<string, unknown>;
  },
) {
  const outcome = await prisma.$transaction(async (tx) => {
    const claim = await tx.providerOrder.updateMany({
      where: { id: providerOrderId, status: { not: ProviderOrderStatus.COMPLETED } },
      data: {
        status: ProviderOrderStatus.COMPLETED,
        ...(result.externalOrderId ? { externalOrderId: result.externalOrderId } : {}),
        responseReference: result.reference,
      },
    });
    if (claim.count !== 1) return { alreadyCompleted: true as const };
    await tx.fulfillment.update({
      where: { orderId },
      data: {
        status: FulfillmentStatus.FULFILLED,
        delivery: result.delivery as Prisma.InputJsonValue,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.DELIVERED,
        events: {
          create: [
            { status: OrderStatus.FULFILLED, note: "Provider concluído com sucesso." },
            { status: OrderStatus.DELIVERED, note: "Entrega disponibilizada." },
          ],
        },
      },
    });
    return { alreadyCompleted: false as const };
  });
  if (!outcome.alreadyCompleted) await sendDeliveryEmail(orderId).catch(() => undefined);
  return outcome;
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
    // registro de Fulfillment e sem nenhum log (ver commerce.ts).
    //
    // INCIDENTE REAL (17/09/2026): o webhook do Asaas chama executeFulfillment
    // de forma síncrona assim que Payment vira PAID; attemptAutomaticGuestRecovery
    // (acionado por um GET do cliente, ex.: /acompanhar) pode chegar a chamar
    // executeFulfillment de novo alguns segundos depois, para o MESMO pedido,
    // enquanto a Order ainda não tem Fulfillment — não há nenhuma janela de
    // "throttle" possível nesse caso porque não existe timestamp para comparar
    // ainda. As duas transações concorrentes tentam o mesmo upsert/claim e uma
    // delas pode ser abortada pelo Postgres com um erro genuíno de conflito
    // (unique constraint ao inserir Fulfillment/ProviderOrder simultaneamente,
    // ou deadlock/serialização da transação interativa) — isso chega aqui como
    // um Prisma.PrismaClientKnownRequestError comum, NÃO como o
    // CONCURRENT_OR_INVALID_EXECUTION que o claim() já trata quando o upsert
    // em si não lança. Tratar esse conflito como falha real marcaria a Order
    // como FAILED mesmo quando a OUTRA execução concorrente está prestes a
    // concluir corretamente — foi exatamente isso que produziu, em produção,
    // "PrismaClientKnownRequestError" nos dois pedidos reais investigados.
    //
    // REVISÃO (continuação, seções 4-6): P2002/P2034 NÃO são tratados
    // genericamente como "outra execução está cuidando disso". Um P2002 pode
    // ser uma corrida legítima, mas também pode ser um bug ou uma violação de
    // constraint completamente diferente — ver classifyPrepareConflict, que
    // só aceita a explicação de concorrência quando (a) a constraint violada
    // é exatamente a que o claim usa (Fulfillment.orderId/ProviderOrder.
    // fulfillmentId), E (b) uma releitura do banco confirma que um
    // Fulfillment realmente existe para este pedido agora.
    const resolution = await classifyPrepareConflict(orderId, prepareError);
    if (resolution === "SAFE_CONCURRENT") {
      console.error(
        "[fulfillment] prepare: conflito de concorrência legítimo (claim perdido para outra execução).",
        { orderId, ...safeErrorInfo(prepareError) },
      );
      throw new FulfillmentEngineError("CONCURRENT_OR_INVALID_EXECUTION");
    }
    console.error(
      "[fulfillment] prepare: erro real, não é um conflito de concorrência reconhecido.",
      { orderId, ...safeErrorInfo(prepareError) },
    );
    await recordPaidFulfillmentFailure(orderId, selected.provider.code);
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
      await finalizeProviderCompletion(orderId, prepared.id, {
        externalOrderId: result.externalOrderId,
        reference: result.reference,
        delivery: result.delivery!,
      });
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

// Operação distinta de executeFulfillment: nunca chama adapter.createOrder.
// Existe exatamente para o estado que validateProviderExecution passou a
// bloquear com RECONCILIATION_REQUIRED (externalOrderId/hasCallback/
// requestReference/resultUncertain) — antes desta função não havia NENHUMA
// ação de produção capaz de sair desse estado além de edição manual no banco.
// Só consulta o provider (getOrderStatus) usando a identidade já registrada;
// nunca gera um novo ticket.
export async function reconcileFulfillment(orderId: string) {
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
  if (order.payment?.status !== PaymentStatus.PAID)
    throw new FulfillmentEngineError("PAYMENT_NOT_PAID");
  if (order.status === OrderStatus.DELIVERED || order.fulfillment?.delivery)
    return { status: "ALREADY_DELIVERED" as const };
  const existing = order.fulfillment?.providerOrders[0];
  if (!existing) throw new FulfillmentEngineError("NO_PROVIDER_ORDER_TO_RECONCILE");

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
  if (!selected) throw new FulfillmentEngineError("PROVIDER_PRODUCT_NOT_FOUND");
  const adapter = resolveProviderAdapter(selected.provider.code);
  if (!adapter) throw new FulfillmentEngineError("PROVIDER_ADAPTER_UNAVAILABLE");
  if (!adapter.supportsReconciliation)
    throw new FulfillmentEngineError("RECONCILIATION_NOT_SUPPORTED");

  // Mesma identidade original: externalOrderId é o que o adapter confirmou
  // (para AdClean, é a própria idempotency_key — ver adclean.ts `completed`/
  // `afterProcessing`).
  //
  // INCIDENTE REAL (17/09/2026): esta função usava antes
  // `existing.externalOrderId ?? existing.requestReference` como fallback.
  // requestReference é só o id interno do próprio ProviderOrder, enviado como
  // `reference` na chamada original — o adapter AdClean NUNCA lê esse campo
  // (createOrder deriva sua própria idempotency_key só de payload.orderId).
  // Em produção, um pedido cujo externalOrderId nunca chegou a ser confirmado
  // caiu nesse fallback: a consulta foi feita com o id interno do
  // ProviderOrder, AdClean corretamente respondeu "não encontrado" para uma
  // chave que nunca existiu, e isso GRAVOU um lastError enganoso
  // (ADCLEAN_TICKET_NOT_FOUND) por cima da evidência real do erro original.
  //
  // Correção definitiva: em vez de um fallback genérico (que o motor
  // genérico não tem como validar), o PRÓPRIO adapter pode expor uma forma
  // determinística e segura de reconstruir sua identidade a partir do
  // orderId (ver ProviderAdapter.buildReconciliationIdentity em types.ts).
  // Para AdClean, isso é a mesma idempotency_key que createOrder já deriva
  // (bancadasoft:<orderId>) — o fulfillment-engine nunca conhece esse
  // formato, só delega ao adapter.
  const identity = existing.externalOrderId ?? adapter.buildReconciliationIdentity?.(orderId);
  if (!identity)
    throw new FulfillmentEngineError("RECONCILIATION_IDENTITY_UNKNOWN");

  let result: ProviderOrderResult;
  try {
    result = await adapter.getOrderStatus(identity);
  } catch (cause) {
    if (cause instanceof ProviderOrderUncertainError)
      return { status: "PROCESSING" as const };
    console.error("[fulfillment] reconcileFulfillment falhou.", {
      orderId,
      providerOrderId: existing.id,
      ...safeErrorInfo(cause),
    });
    // Preserva o erro original do adapter (ex.: um erro real da 1ª tentativa
    // de gerar-ticket) em vez de deixar uma falha de reconciliação
    // sobrescrevê-lo — essa perda de evidência dificultou o diagnóstico do
    // incidente real (seção 16 da tarefa).
    if (!hasMoreInformativeOriginalError(existing.lastError)) {
      await prisma.providerOrder
        .update({
          where: { id: existing.id },
          data: { lastError: `RECONCILIATION_${safeErrorInfo(cause).code}` },
        })
        .catch(() => undefined);
    }
    throw new FulfillmentEngineError("RECONCILIATION_FAILED");
  }

  const outcome = providerOutcome(result.status, result.delivery);
  if (outcome.deliver) {
    await finalizeProviderCompletion(orderId, existing.id, {
      externalOrderId: result.externalOrderId,
      reference: result.reference,
      delivery: result.delivery!,
    });
    return { status: "COMPLETED" as const };
  }
  if (result.status === "PROCESSING") {
    if (result.externalOrderId && result.externalOrderId !== existing.externalOrderId)
      await prisma.providerOrder.update({
        where: { id: existing.id },
        data: { externalOrderId: result.externalOrderId },
      });
    return { status: "PROCESSING" as const };
  }
  // result.status === "FAILED" (ex.: AdClean "encontrado:false"). Território
  // perigoso (auditoria, seção 10/Caso C, e seção 31 desta etapa): uma
  // resposta NOT_FOUND não prova que a operação nunca existiu no provider —
  // pode só significar que ainda não está disponível. Esta correção nunca
  // deduz "seguro criar outro ticket" disso: mantém o estado reconciliável
  // (WAIT/MANUAL_REVIEW implícito — nenhum novo gerar-ticket é permitido
  // sem política explícita e evidência adicional), sem apagar
  // requestReference/histórico. lastError só é sobrescrito quando não havia
  // um erro original mais informativo (ver reconciliationLastError).
  console.error("[fulfillment] reconcileFulfillment: resultado inconclusivo do provider.", {
    orderId,
    providerOrderId: existing.id,
    providerStatus: result.status,
    providerError: result.error ?? null,
  });
  if (!hasMoreInformativeOriginalError(existing.lastError)) {
    await prisma.providerOrder.update({
      where: { id: existing.id },
      data: { lastError: `RECONCILIATION_${result.error ?? "INCONCLUSIVE"}` },
    });
  }
  return { status: "PROCESSING" as const };
}

// Incidente real (17/09/2026): uma reconciliação inconclusiva NUNCA deve
// apagar um erro original mais informativo do adapter (ex.: um HTTP 500 real
// da 1ª tentativa de gerar-ticket). Só é seguro escrever um novo lastError
// quando não havia nenhum ainda, ou quando o que já estava lá também veio de
// uma reconciliação anterior (prefixo RECONCILIATION_) — nesse caso não há
// evidência original a perder.
function hasMoreInformativeOriginalError(existingLastError: string | null) {
  return Boolean(existingLastError && !existingLastError.startsWith("RECONCILIATION_"));
}

// Janela mínima entre duas tentativas automáticas de recovery/reconciliação
// para o MESMO pedido. Não é um novo campo/migration: reaproveita updatedAt
// (já existente em Fulfillment e ProviderOrder) como relógio de throttling —
// cada tentativa (mesmo inconclusiva) atualiza esses timestamps sozinha.
const AUTO_RECOVERY_THROTTLE_MS = 20_000;

// Aciona recovery/reconciliação automaticamente a partir do endpoint de
// status do pedido (polling do cliente guest e restore de F5) — NUNCA a
// partir do browser diretamente. Existe para que "pagamento confirmado, mas
// fulfillment não converge" se resolva sozinho sem depender do Admin, sem
// transformar cada poll do cliente numa chamada ao provider: só age quando o
// estado está PAID/sem entrega E a última tentativa já está mais velha que
// AUTO_RECOVERY_THROTTLE_MS. Retorna true quando decidiu tentar algo (para o
// chamador saber se vale reler o pedido antes de responder).
export async function attemptAutomaticGuestRecovery(orderId: string): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      payment: { select: { status: true } },
      fulfillment: {
        select: {
          status: true,
          delivery: true,
          updatedAt: true,
          providerOrders: {
            select: {
              status: true,
              updatedAt: true,
              requestReference: true,
              externalOrderId: true,
              lastError: true,
              callbackEvents: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!order) return false;
  const item = order.fulfillment?.providerOrders[0];
  // Classificador único (seção 12 da tarefa): a mesma regra que decide
  // CLEAN_RECOVERY vs RECONCILE aqui também decide no Admin (retry/route.ts)
  // e no sweep server-side (cron) — nunca mais três cópias divergentes.
  const action = classifyFulfillmentRecovery({
    paymentStatus: order.payment?.status,
    orderStatus: order.status,
    hasDelivery: Boolean(order.fulfillment?.delivery),
    providerOrder: item
      ? {
          status: item.status,
          requestReference: item.requestReference,
          externalOrderId: item.externalOrderId,
          lastError: item.lastError,
          callbackEventCount: item.callbackEvents.length,
        }
      : null,
  });
  if (action === "NO_ACTION" || action === "ALREADY_DELIVERED") return false;
  const stale = (updatedAt: Date) =>
    Date.now() - updatedAt.getTime() >= AUTO_RECOVERY_THROTTLE_MS;
  try {
    if (action === "CLEAN_RECOVERY") {
      // Sem ProviderOrder (ou nenhuma evidência de tentativa externa nele) —
      // tão seguro quanto a 1ª execução automática.
      if (order.fulfillment && !stale(order.fulfillment.updatedAt)) return false;
      await executeFulfillment(orderId, { retry: false });
      return true;
    }
    // action === "RECONCILE": NUNCA gerar-ticket de novo aqui — só
    // reconciliar (reconcileFulfillment nunca chama adapter.createOrder).
    if (!item || !stale(item.updatedAt)) return false;
    await reconcileFulfillment(orderId);
    return true;
  } catch (cause) {
    // Nunca deixar o recovery automático derrubar a resposta de status ao
    // cliente — mas o erro precisa ficar visível em log (além do que já é
    // gravado em ProviderOrder/Fulfillment), porque antes desta correção uma
    // falha aqui era completamente silenciosa e dificultou a investigação do
    // incidente real de 17/09/2026.
    console.error("[fulfillment] attemptAutomaticGuestRecovery falhou.", {
      orderId,
      action,
      ...safeErrorInfo(cause),
    });
    return true;
  }
}
