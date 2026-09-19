import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  executeFulfillment,
  reconcileFulfillment,
  FulfillmentEngineError,
} from "@/lib/fulfillment-engine";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { classifyFulfillmentRecovery } from "@/lib/fulfillment-rules";

type Context = { params: Promise<{ id: string }> };

const providerOrderSelect = {
  id: true,
  status: true,
  requestReference: true,
  externalOrderId: true,
  lastError: true,
  _count: { select: { callbackEvents: true } },
} as const;

const orderSelect = {
  status: true,
  payment: { select: { status: true } },
  fulfillment: { select: { delivery: true, providerOrders: { select: providerOrderSelect } } },
} as const;

type ProviderOrderRow = {
  status: string;
  requestReference: string | null;
  externalOrderId: string | null;
  lastError: string | null;
  _count: { callbackEvents: number };
};
type OrderForClassification = {
  status: string;
  payment: { status: string } | null;
  fulfillment: { delivery: unknown; providerOrders: ProviderOrderRow[] } | null;
} | null;

// Classificador ÚNICO (seção 12 da tarefa): a mesma regra usada pelo recovery
// automático do guest (attemptAutomaticGuestRecovery) e, quando existir, pelo
// sweep server-side (cron). Admin nunca decide sozinho se é seguro repetir
// gerar-ticket ou só reconciliar.
function classify(order: OrderForClassification) {
  const item = order?.fulfillment?.providerOrders[0];
  return classifyFulfillmentRecovery({
    paymentStatus: order?.payment?.status,
    orderStatus: order?.status,
    hasDelivery: Boolean(order?.fulfillment?.delivery),
    providerOrder: item
      ? {
          status: item.status,
          requestReference: item.requestReference,
          externalOrderId: item.externalOrderId,
          lastError: item.lastError,
          callbackEventCount: item._count?.callbackEvents ?? 0,
        }
      : null,
  });
}

export async function GET(_: Request, context: Context) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await context.params;
  const order = await prisma.order.findUnique({ where: { id }, select: orderSelect });
  const recoveryAction = classify(order);

  let action: "RETRY" | "RECONCILE" | null = null;
  let message = "Recuperação indisponível para este pedido.";
  if (recoveryAction === "CLEAN_RECOVERY") {
    action = "RETRY";
    message = "Pagamento confirmado. A liberação ainda não foi iniciada.";
  } else if (recoveryAction === "RECONCILE") {
    action = "RECONCILE";
    message =
      "Pagamento confirmado. Estamos verificando uma tentativa anterior com o provider.";
  } else if (recoveryAction === "ALREADY_DELIVERED") {
    message = "Entrega já concluída.";
  }
  return NextResponse.json({
    data: { allowed: action !== null, action, message },
  });
}

export async function POST(_: Request, context: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await context.params;
  const order = await prisma.order.findUnique({ where: { id }, select: orderSelect });
  const item = order?.fulfillment?.providerOrders[0];
  const recoveryAction = classify(order);
  try {
    let result: { status: string };
    let auditAction: string;
    if (recoveryAction === "RECONCILE") {
      // Classificador indicou evidência de contato externo: NUNCA chamar
      // gerar-ticket de novo aqui — só reconciliar o resultado já em curso.
      result = await reconcileFulfillment(id);
      auditAction = "FULFILLMENT_RECONCILE";
    } else {
      // Qualquer outro caso (inclusive um estado que mudou entre o GET e
      // este POST) é decidido de forma definitiva por executeFulfillment,
      // que tem sua própria validação autoritativa (validateProviderExecution).
      const retry = Boolean(item);
      result = await executeFulfillment(id, { retry });
      auditAction = retry ? "FULFILLMENT_RETRY" : "FULFILLMENT_RECOVER";
    }
    await audit(admin.id, auditAction, "Order", id, { result: "accepted" });
    return NextResponse.json({ data: result });
  } catch (error) {
    const message =
      error instanceof FulfillmentEngineError ? error.code : "Falha ao executar retry.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
