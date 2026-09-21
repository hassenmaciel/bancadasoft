import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/prisma";
import { attemptAutomaticGuestRecovery, safeErrorInfo } from "@/lib/fulfillment-engine";
import { HEARTUNLOCKS_CODE } from "@/lib/providers/heartunlocks";

export const dynamic = "force-dynamic";

// Quantos pedidos candidatos processar por execução — nunca findMany sem
// limite (seção 38 da tarefa). Um valor pequeno é suficiente para o volume
// atual do projeto; aumentar exige evidência de necessidade, não elegância
// arquitetural prematura. Nenhum índice novo foi necessário: Payment.status
// e Order.status já são filtros simples sobre colunas existentes, e o volume
// atual do projeto não justifica uma migration só para isso.
const RECOVERY_SWEEP_BATCH_SIZE = 20;

// Recovery server-side durável (seção 8 da tarefa): mecanismo agendado
// (Supabase Cron + pg_net, ver docs/infra/supabase-cron-fulfillment-recovery.sql) que NÃO depende de nenhum GET do navegador.
// Reaproveita exatamente o mesmo classificador/throttle/claim que já protege
// o recovery automático disparado por GET — nenhuma lógica de concorrência
// nova foi inventada aqui, só um novo GATILHO para a mesma ação seguindo a
// mesma regra central (seção 12).
export async function GET(request: Request) {
  if (!validateCronSecret(request.headers.get("authorization")))
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });

  const candidates = await prisma.order.findMany({
    where: {
      payment: { status: "PAID" },
      status: { notIn: ["DELIVERED", "CANCELLED"] },
      // HeartUnlocks confirma só por callback (sem reconciliação): pedido já
      // enviado ao provider falharia com RECONCILIATION_NOT_SUPPORTED sem
      // escrever nada, ficaria no topo do lote (updatedAt asc) e o ocuparia
      // até o callback chegar (ou para sempre, se FAILED).
      NOT: {
        fulfillment: {
          is: {
            providerOrders: {
              some: {
                provider: { code: HEARTUNLOCKS_CODE },
                requestReference: { not: null },
              },
            },
          },
        },
      },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: RECOVERY_SWEEP_BATCH_SIZE,
  });

  let attempted = 0;
  let skipped = 0;
  let errored = 0;
  for (const { id } of candidates) {
    try {
      // attemptAutomaticGuestRecovery já é throttlado (AUTO_RECOVERY_THROTTLE_MS,
      // via updatedAt existente) e nunca chama gerar-ticket duas vezes para o
      // mesmo pedido — sem lock externo, sem estado em memória: a proteção
      // real é o claim atômico dentro de executeFulfillment/reconcileFulfillment.
      const didAttempt = await attemptAutomaticGuestRecovery(id);
      if (didAttempt) attempted += 1;
      else skipped += 1;
    } catch (cause) {
      // attemptAutomaticGuestRecovery já engloba e loga seus próprios erros
      // internamente (retornando true) — chegar aqui só é possível se a
      // própria leitura inicial dela falhar de forma inesperada. Uma falha
      // em UM pedido nunca interrompe o processamento dos demais.
      errored += 1;
      console.error("[fulfillment] sweep: falha inesperada ao processar candidato.", {
        orderId: id,
        ...safeErrorInfo(cause),
      });
    }
  }

  console.log("[fulfillment] sweep: execução concluída.", {
    candidates: candidates.length,
    attempted,
    skipped,
    errored,
  });

  return NextResponse.json({
    data: { candidates: candidates.length, attempted, skipped, errored },
  });
}
