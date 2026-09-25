import { NextResponse } from "next/server";
import { AccountLedgerEntryType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  AccountBalanceError,
  REFUND_REFERENCE_PREFIX,
  debitPurchase,
  refundPurchase,
} from "@/lib/account-balance";
import { bearerKey, hashResellerApiKey } from "@/lib/reseller-keys";
import {
  ADCLEAN_CODE,
  ADCLEAN_TICKET_PRODUCT_ID,
  AdcleanProviderError,
} from "@/lib/providers/adclean";
import { ADCLEAN_TICKET_DURATION_HOURS } from "@/lib/providers/adclean-contract";
import {
  ProviderNotConnectedError,
  type ProviderAdapter,
  type ProviderOrderResult,
} from "@/lib/providers/types";

// POST /api/reseller/v1/tickets — compra programática de ticket AdClean por
// revendedor, debitando o saldo pré-pago (AccountBalance/AccountLedgerEntry).
// Ordem das checagens (nada é debitado antes do passo 7):
//   1. chave Bearer válida, ativa e não revogada .............. 401
//   2. role RESELLER e saldo habilitado ....................... 403
//   3. corpo com external_reference válida .................... 400
//   4. external_reference já usada -> devolve o resultado anterior (replay)
//   5. limite de compras por janela ........................... 429
//   6. revenda AdClean configurada (ADCLEAN_RESELLER_TOKEN) .... 503
//   7. produto com resellerPriceCents e saldo suficiente ...... 409 / 402
//   8. débito (lançamento PURCHASE) e só então a chamada ao AdClean
//   9. falha definitiva do AdClean -> estorno (REFUND) ........ 502

// Rate limit: no máximo 10 compras novas por minuto por conta de revendedor
// (somando todas as chaves da conta). Conservador de propósito: cada compra
// gera um ticket real e um débito real. O contador usa os lançamentos
// PURCHASE do próprio ledger, então vale entre instâncias serverless sem
// estado novo. Replays (mesma external_reference) não contam, porque não
// criam lançamento.
export const RESELLER_RATE_LIMIT = { windowMs: 60_000, maxPurchases: 10 } as const;

// Sem ":" para nunca colidir com as referências internas de estorno
// ("refund:<ref>"). Mesmo formato aceito por sistemas de pedido comuns.
const EXTERNAL_REFERENCE = /^[A-Za-z0-9._-]{1,100}$/;
const bodySchema = z.object({ external_reference: z.string().regex(EXTERNAL_REFERENCE) });

// Falhas em que o AdClean comprovadamente NÃO gerou ticket: estorna.
// Qualquer outra falha (timeout, 5xx, resposta inválida, conflito de
// idempotência) é tratada como incerta: não estorna e devolve PROCESSING; o
// revendedor reenvia a mesma external_reference para consultar.
const DEFINITIVE_ADCLEAN_ERRORS = new Set([
  "ADCLEAN_NOT_AUTHORIZED",
  "ADCLEAN_BODY_INVALID",
  "ADCLEAN_IDEMPOTENCY_KEY_INVALID",
]);
export function isDefinitiveAdcleanFailure(error: unknown) {
  if (error instanceof ProviderNotConnectedError) return true;
  if (!(error instanceof AdcleanProviderError)) return false;
  return DEFINITIVE_ADCLEAN_ERRORS.has(error.code) || /^ADCLEAN_HTTP_4\d\d$/.test(error.code);
}

export function resellerOrderId(purchaseEntryId: string) {
  return `revenda-${purchaseEntryId}`;
}

type Db = Pick<
  PrismaClient,
  "$transaction" | "resellerApiKey" | "accountBalance" | "accountLedgerEntry" | "providerProduct"
>;
export type ResellerApiDeps = {
  db: Db;
  adapter: () => ProviderAdapter;
  configured: () => boolean;
  now?: () => Date;
  log?: (message: string, context: Record<string, unknown>) => void;
};

type PurchaseEntry = { id: string; amountCents: number; externalReference: string | null };

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
const fail = (status: number, code: string, error: string) => json(status, { ok: false, code, error });

function errorCode(error: unknown) {
  if (error instanceof AdcleanProviderError) return error.code;
  if (error instanceof Error) return error.name;
  return "UNKNOWN";
}

export async function handleResellerTicketRequest(request: Request, deps: ResellerApiDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message, context) => console.error(message, context));
  const { db } = deps;

  // 1. Autenticação
  const key = bearerKey(request.headers.get("authorization"));
  if (!key) return fail(401, "INVALID_API_KEY", "Chave de API inválida.");
  const apiKey = await db.resellerApiKey.findUnique({
    where: { tokenHash: hashResellerApiKey(key) },
    select: { id: true, active: true, revokedAt: true, user: { select: { id: true, role: true, active: true } } },
  });
  if (!apiKey || !apiKey.active || apiKey.revokedAt || !apiKey.user.active)
    return fail(401, "INVALID_API_KEY", "Chave de API inválida.");
  const userId = apiKey.user.id;
  await db.resellerApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: now() } })
    .catch(() => undefined);

  // 2. Autorização
  if (apiKey.user.role !== "RESELLER")
    return fail(403, "RESELLER_ROLE_REQUIRED", "Conta sem permissão de revenda.");
  const balance = await db.accountBalance.findUnique({ where: { userId }, select: { enabled: true } });
  if (!balance?.enabled) return fail(403, "BALANCE_NOT_ENABLED", "Saldo não habilitado para esta conta.");

  // 3. Corpo
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return fail(400, "INVALID_BODY", "Informe external_reference (1-100 caracteres: letras, números, ponto, hífen ou sublinhado).");
  const externalReference = parsed.data.external_reference;

  // 4. Idempotência: referência já usada -> resultado anterior, sem novo débito.
  const previous = await db.accountLedgerEntry.findFirst({
    where: { userId, externalReference, type: AccountLedgerEntryType.PURCHASE },
    select: { id: true, amountCents: true, externalReference: true },
  });
  if (previous) return replay(previous, userId, deps, log);

  // 5. Rate limit
  const recentPurchases = await db.accountLedgerEntry.count({
    where: {
      userId,
      type: AccountLedgerEntryType.PURCHASE,
      createdAt: { gte: new Date(now().getTime() - RESELLER_RATE_LIMIT.windowMs) },
    },
  });
  if (recentPurchases >= RESELLER_RATE_LIMIT.maxPurchases)
    return fail(429, "RATE_LIMITED", "Muitas compras em pouco tempo. Aguarde um minuto e tente de novo.");

  // 6. Integração configurada
  if (!deps.configured())
    return fail(503, "RESELLER_INTEGRATION_NOT_CONFIGURED", "Integração de revenda ainda não configurada.");

  // 7. Preço de revenda
  const link = await db.providerProduct.findFirst({
    where: { externalProductId: ADCLEAN_TICKET_PRODUCT_ID, provider: { code: ADCLEAN_CODE } },
    select: { product: { select: { resellerPriceCents: true } } },
  });
  const priceCents = link?.product?.resellerPriceCents ?? null;
  if (!priceCents || priceCents < 1)
    return fail(409, "PRODUCT_NOT_AVAILABLE_FOR_RESALE", "Produto indisponível para revenda.");

  // 8. Débito (trava a linha de saldo; reconfere referência e saldo lá dentro)
  let purchase: { entry: PurchaseEntry & { balanceAfterCents: number }; created: boolean };
  try {
    purchase = await db.$transaction((tx) =>
      debitPurchase(tx, {
        userId,
        externalReference,
        amountCents: priceCents,
        note: `Revenda AdClean ${ADCLEAN_TICKET_PRODUCT_ID}`,
      }),
    );
  } catch (error) {
    if (error instanceof AccountBalanceError && error.code === "INSUFFICIENT_BALANCE")
      return fail(402, "INSUFFICIENT_BALANCE", "Saldo insuficiente.");
    if (error instanceof AccountBalanceError && error.code === "BALANCE_NOT_ENABLED")
      return fail(403, "BALANCE_NOT_ENABLED", "Saldo não habilitado para esta conta.");
    throw error;
  }
  // Corrida com outro request da mesma referência: vira replay.
  if (!purchase.created) return replay(purchase.entry, userId, deps, log);

  return fulfill(purchase.entry, userId, deps, log, false);
}

async function fulfill(
  entry: PurchaseEntry,
  userId: string,
  deps: ResellerApiDeps,
  log: NonNullable<ResellerApiDeps["log"]>,
  isReplay: boolean,
) {
  const chargedCents = Math.abs(entry.amountCents);
  let result: ProviderOrderResult | null = null;
  try {
    const adapter = deps.adapter();
    const orderId = resellerOrderId(entry.id);
    // Replay: consulta primeiro (nunca gera). Só se o AdClean não conhecer a
    // chave é que a geração é pedida, com a MESMA idempotency_key — o débito
    // já foi pago e o próprio AdClean impede ticket duplicado.
    if (isReplay) {
      const found = await adapter.getOrderStatus(adapter.buildReconciliationIdentity?.(orderId) ?? orderId);
      if (!(found.status === "FAILED" && found.error === "ADCLEAN_TICKET_NOT_FOUND")) result = found;
    }
    result ??= await adapter.createOrder({
      providerProductId: ADCLEAN_TICKET_PRODUCT_ID,
      reference: entry.id,
      payload: { orderId, paidAmountCents: chargedCents },
    });
  } catch (error) {
    if (!isDefinitiveAdcleanFailure(error)) {
      log("[reseller] resultado incerto do AdClean; sem estorno.", { userId, entryId: entry.id, code: errorCode(error) });
      return processing(entry, chargedCents);
    }
    log("[reseller] falha definitiva do AdClean; estornando.", { userId, entryId: entry.id, code: errorCode(error) });
    return refundAndFail(entry, userId, deps, chargedCents);
  }

  const code = result.status === "COMPLETED" ? codeFrom(result) : null;
  if (code) {
    const balance = await deps.db.accountBalance.findUnique({ where: { userId }, select: { balanceCents: true } });
    return json(200, {
      ok: true,
      status: "COMPLETED",
      replay: isReplay,
      external_reference: entry.externalReference,
      ticket: { code, duration_hours: ADCLEAN_TICKET_DURATION_HOURS },
      charged_cents: chargedCents,
      balance_cents: balance?.balanceCents ?? null,
    });
  }
  if (result.status === "FAILED" && !isReplay) {
    log("[reseller] AdClean devolveu FAILED; estornando.", { userId, entryId: entry.id, code: result.error ?? "FAILED" });
    return refundAndFail(entry, userId, deps, chargedCents);
  }
  return processing(entry, chargedCents);
}

async function replay(
  entry: PurchaseEntry,
  userId: string,
  deps: ResellerApiDeps,
  log: NonNullable<ResellerApiDeps["log"]>,
) {
  const refunded = await deps.db.accountLedgerEntry.findFirst({
    where: { userId, externalReference: `${REFUND_REFERENCE_PREFIX}${entry.externalReference}` },
    select: { id: true },
  });
  if (refunded)
    return json(502, {
      ok: false,
      status: "FAILED",
      replay: true,
      refunded: true,
      code: "TICKET_FAILED_REFUNDED",
      error: "A emissão falhou e o valor foi estornado ao saldo. Use uma nova external_reference para tentar de novo.",
      external_reference: entry.externalReference,
    });
  if (!deps.configured())
    return fail(503, "RESELLER_INTEGRATION_NOT_CONFIGURED", "Integração de revenda ainda não configurada.");
  return fulfill(entry, userId, deps, log, true);
}

async function refundAndFail(entry: PurchaseEntry, userId: string, deps: ResellerApiDeps, chargedCents: number) {
  await deps.db.$transaction((tx) =>
    refundPurchase(tx, {
      userId,
      purchaseEntryId: entry.id,
      externalReference: entry.externalReference ?? entry.id,
      amountCents: chargedCents,
    }),
  );
  return json(502, {
    ok: false,
    status: "FAILED",
    refunded: true,
    code: "TICKET_FAILED_REFUNDED",
    error: "A emissão falhou e o valor foi estornado ao saldo. Use uma nova external_reference para tentar de novo.",
    external_reference: entry.externalReference,
  });
}

function processing(entry: PurchaseEntry, chargedCents: number) {
  return json(202, {
    ok: true,
    status: "PROCESSING",
    external_reference: entry.externalReference,
    charged_cents: chargedCents,
    message: "Emissão em confirmação. Reenvie a mesma external_reference para consultar o resultado.",
  });
}

function codeFrom(result: ProviderOrderResult) {
  const credential = result.delivery?.credential;
  return typeof credential === "string" && credential.trim() ? credential.trim() : null;
}
