import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  executeFulfillment,
  reconcileFulfillment,
  FulfillmentEngineError,
} from "@/lib/fulfillment-engine";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { hasExternalAttemptEvidence } from "@/lib/fulfillment-rules";

type Context = { params: Promise<{ id: string }> };

const providerOrderSelect = {
  id: true,
  status: true,
  attempts: true,
  requestReference: true,
  externalOrderId: true,
  lastError: true,
  _count: { select: { callbackEvents: true } },
} as const;

type ProviderOrderEvidence = {
  requestReference: string | null;
  externalOrderId: string | null;
  lastError: string | null;
  _count: { callbackEvents: number };
};

const externalAttemptOf = (item?: ProviderOrderEvidence) =>
  hasExternalAttemptEvidence(
    item && {
      requestReference: item.requestReference,
      externalOrderId: item.externalOrderId,
      lastError: item.lastError,
      callbackEventCount: item._count?.callbackEvents ?? 0,
    },
  );

export async function GET(_: Request, context: Context) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await context.params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      status: true,
      payment: { select: { status: true } },
      fulfillment: {
        select: {
          delivery: true,
          providerOrders: { select: providerOrderSelect },
        },
      },
    },
  });
  const item = order?.fulfillment?.providerOrders[0];
  // Sem ProviderOrder (fulfillment nunca chegou a chamar o provider —
  // inclusive quando Fulfillment(FAILED) foi registrado sem ProviderOrder,
  // ver recordPaidFulfillmentFailure em fulfillment-engine.ts), a primeira
  // execução real é tão segura quanto um retry limpo: executeFulfillment
  // decide sozinho o modo correto (ver POST abaixo).
  const neverReachedProvider = !item;
  const externalAttempt = externalAttemptOf(item);
  const cleanFailedRetry = Boolean(
    item && item.status === "FAILED" && item.attempts < 3 && !externalAttempt,
  );
  const alreadyDelivered =
    order?.status === "DELIVERED" || Boolean(order?.fulfillment?.delivery);
  const baseOk = order?.payment?.status === "PAID" && !alreadyDelivered;

  let action: "RETRY" | "RECONCILE" | null = null;
  let message = "Recuperação indisponível para este pedido.";
  if (baseOk && (neverReachedProvider || cleanFailedRetry)) {
    action = "RETRY";
    message = "Pagamento confirmado. A liberação ainda não foi iniciada.";
  } else if (baseOk && item) {
    action = "RECONCILE";
    message =
      "Pagamento confirmado. Estamos verificando uma tentativa anterior com o provider.";
  } else if (alreadyDelivered) {
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
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      fulfillment: { select: { providerOrders: { select: providerOrderSelect } } },
    },
  });
  const item = order?.fulfillment?.providerOrders[0];
  const externalAttempt = externalAttemptOf(item);
  try {
    let result: { status: string };
    let auditAction: string;
    if (item && externalAttempt) {
      // Já existe evidência de contato externo: NUNCA chamar gerar-ticket de
      // novo aqui — só reconciliar o resultado já em curso no provider.
      result = await reconcileFulfillment(id);
      auditAction = "FULFILLMENT_RECONCILE";
    } else {
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
