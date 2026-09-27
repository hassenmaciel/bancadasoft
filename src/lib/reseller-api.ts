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
import { AdcleanLicenseError, type OrderLookup } from "@/lib/providers/adclean-license";
import {
  ProviderNotConnectedError,
  type ProviderAdapter,
  type ProviderOrderResult,
} from "@/lib/providers/types";

// POST /api/reseller/v1/tickets — compra programática por revendedor,
// debitando o saldo pré-pago (AccountBalance/AccountLedgerEntry).
//
// Sem "product" no corpo a compra é o ticket AdClean avulso, exatamente como
// no contrato original. Com "product" (Product.slug; um Product por período,
// sem variantes, pois resellerPriceCents é do Product) o ProviderProduct
// vinculado ao Product escolhe o fulfiller pelo código do Provider (ticket ou
// licença AdClean).
//
// Ordem das checagens (nada é debitado antes do passo 10):
//   1. chave Bearer válida, ativa e não revogada .............. 401
//   2. role RESELLER e saldo habilitado ....................... 403
//   3. corpo válido (external_reference; product) ............. 400
//   4. external_reference já usada -> devolve o resultado anterior (replay)
//   5. limite de compras por janela ........................... 429
//   6. produto conhecido para revenda ......................... 400
//   7. e-mail do cliente final, se o produto exigir ........... 400
//   8. integração do fornecedor configurada ................... 503
//   9. produto com resellerPriceCents e saldo suficiente ...... 409 / 402
//  10. débito (lançamento PURCHASE) e só então a chamada ao fornecedor
//  11. falha definitiva do fornecedor -> estorno (REFUND) ..... 502

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
const IDENTIFIER = /^[A-Za-z0-9._-]{1,120}$/;
const productSchema = z.object({ product: z.string().regex(IDENTIFIER).optional() });
const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

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

// Licença: definitivas são as barradas antes da chamada (pedido/período/e-mail
// inválidos) e os 4xx do AdClean. 200 sem código e 2xx inesperados ficam
// incertos; 409/429/5xx o adapter já devolve como PROCESSING/incerto.
export function isDefinitiveAdcleanLicenseFailure(error: unknown) {
  if (error instanceof ProviderNotConnectedError) return true;
  if (!(error instanceof AdcleanLicenseError)) return false;
  if (error.code === "ADCLEAN_LICENSE_INVALID_RESPONSE") return false;
  const http = /^ADCLEAN_LICENSE_HTTP_(\d{3})$/.exec(error.code);
  return http ? http[1].startsWith("4") : true;
}

export function resellerOrderId(purchaseEntryId: string) {
  return `revenda-${purchaseEntryId}`;
}

type Db = Pick<
  PrismaClient,
  "$transaction" | "resellerApiKey" | "accountBalance" | "accountLedgerEntry" | "providerProduct"
>;

// O que foi comprado. Fica no note do lançamento PURCHASE para o replay
// repetir exatamente a mesma emissão (mesmo produto, mesmo e-mail).
export type ResellerPurchase = {
  orderId: string;
  providerCode: string;
  externalProductId: string;
  email: string | null;
  metadata: unknown;
};

// Um fulfiller por Provider.code. O do ticket é montado de deps.adapter e
// deps.configured (contrato original); os demais vêm de deps.fulfillers.
export type ResellerFulfiller = {
  configured: () => boolean;
  adapter: (purchase: ResellerPurchase) => ProviderAdapter;
  requiresEmail: boolean;
  isDefinitiveFailure: (error: unknown) => boolean;
  // Replay: consulta que significa "o fornecedor não conhece a chave" -> pede
  // a geração com a mesma chave.
  isUnknownOnReplay?: (result: ProviderOrderResult) => boolean;
  completedBody: (result: ProviderOrderResult, purchase: ResellerPurchase) => Record<string, unknown> | null;
  failedCode: string;
};

export type ResellerApiDeps = {
  db: Db;
  adapter: () => ProviderAdapter;
  configured: () => boolean;
  fulfillers?: Record<string, ResellerFulfiller>;
  now?: () => Date;
  log?: (message: string, context: Record<string, unknown>) => void;
};

type PurchaseEntry = { id: string; amountCents: number; externalReference: string | null; note?: string | null };
type Bought = Pick<ResellerPurchase, "providerCode" | "externalProductId" | "email">;

// Formato do note: "Revenda <provider> <externalProductId>[ <email>]". O
// ticket mantém o texto histórico "Revenda AdClean ticket-168h"; note
// ausente/ilegível é ticket (único produto vendido antes da licença).
const TICKET_NOTE_LABEL = "AdClean";
export function resellerNote(bought: Bought) {
  const label = bought.providerCode === ADCLEAN_CODE ? TICKET_NOTE_LABEL : bought.providerCode;
  return ["Revenda", label, bought.externalProductId, bought.email].filter(Boolean).join(" ");
}
export function parseResellerNote(note: string | null | undefined): Bought {
  const [prefix, label, externalProductId, email] = (note ?? "").split(" ");
  if (prefix !== "Revenda" || !label || !externalProductId)
    return { providerCode: ADCLEAN_CODE, externalProductId: ADCLEAN_TICKET_PRODUCT_ID, email: null };
  return {
    providerCode: label === TICKET_NOTE_LABEL ? ADCLEAN_CODE : label,
    externalProductId,
    email: email || null,
  };
}

function ticketFulfiller(deps: ResellerApiDeps): ResellerFulfiller {
  return {
    configured: deps.configured,
    adapter: () => deps.adapter(),
    requiresEmail: false,
    isDefinitiveFailure: isDefinitiveAdcleanFailure,
    isUnknownOnReplay: (result) => result.status === "FAILED" && result.error === "ADCLEAN_TICKET_NOT_FOUND",
    completedBody: (result) => {
      const code = codeFrom(result);
      return code ? { ticket: { code, duration_hours: ADCLEAN_TICKET_DURATION_HOURS } } : null;
    },
    failedCode: "TICKET_FAILED_REFUNDED",
  };
}

// Licença AdClean: sem Order da loja, o adapter recebe um lookup que devolve
// a própria compra (e-mail do cliente final + ProviderProduct). Identidade no
// AdClean: bancadasoft-licenca:revenda-<lançamento>.
export function adcleanLicenseResellerFulfiller(options: {
  configured: () => boolean;
  adapter: (loadOrder: OrderLookup) => ProviderAdapter;
}): ResellerFulfiller {
  return {
    configured: options.configured,
    adapter: (purchase) =>
      options.adapter(async (orderId) =>
        orderId === purchase.orderId && purchase.email
          ? {
              email: purchase.email,
              externalProductId: purchase.externalProductId,
              providerCode: purchase.providerCode,
              metadata: purchase.metadata,
            }
          : null,
      ),
    requiresEmail: true,
    isDefinitiveFailure: isDefinitiveAdcleanLicenseFailure,
    completedBody: (result, purchase) => {
      const code = codeFrom(result);
      if (!code) return null;
      const raw = (result.delivery?.adcleanLicense ?? {}) as { email?: unknown; periodo_horas?: unknown };
      const metadata = (purchase.metadata ?? {}) as { periodo_horas?: unknown };
      return {
        license: {
          code,
          email: typeof raw.email === "string" && raw.email ? raw.email : purchase.email,
          period_hours:
            typeof raw.periodo_horas === "number"
              ? raw.periodo_horas
              : typeof metadata.periodo_horas === "number"
                ? metadata.periodo_horas
                : null,
        },
      };
    },
    failedCode: "LICENSE_FAILED_REFUNDED",
  };
}

function fulfillerFor(deps: ResellerApiDeps, providerCode: string) {
  if (providerCode === ADCLEAN_CODE) return ticketFulfiller(deps);
  return deps.fulfillers?.[providerCode] ?? null;
}

type Resolved = Omit<Bought, "email"> & { metadata: unknown; priceCents: number | null };

// Sem "product": exatamente a consulta original do ticket. Com "product": o
// ProviderProduct vinculado direto ao Product (ProviderProduct.productId).
async function resolveProduct(db: Db, product?: string): Promise<Resolved | null> {
  if (!product) {
    const link = await db.providerProduct.findFirst({
      where: { externalProductId: ADCLEAN_TICKET_PRODUCT_ID, provider: { code: ADCLEAN_CODE } },
      select: { product: { select: { resellerPriceCents: true } } },
    });
    return {
      providerCode: ADCLEAN_CODE,
      externalProductId: ADCLEAN_TICKET_PRODUCT_ID,
      metadata: null,
      priceCents: link?.product?.resellerPriceCents ?? null,
    };
  }
  const links = await db.providerProduct.findMany({
    where: { active: true, product: { slug: product } },
    select: {
      externalProductId: true,
      metadata: true,
      provider: { select: { code: true } },
      product: { select: { resellerPriceCents: true } },
    },
    take: 2,
  });
  // Mais de um vínculo ativo seria ambíguo: nunca escolhe um ao acaso. O note
  // separa os campos por espaço: identificador com espaço não é revendável.
  const [link] = links;
  if (links.length !== 1 || /\s/.test(link.externalProductId)) return null;
  return {
    providerCode: link.provider.code,
    externalProductId: link.externalProductId,
    metadata: link.metadata,
    priceCents: link.product?.resellerPriceCents ?? null,
  };
}

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
const fail = (status: number, code: string, error: string) => json(status, { ok: false, code, error });

function errorCode(error: unknown) {
  if (error instanceof AdcleanProviderError || error instanceof AdcleanLicenseError) return error.code;
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
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success)
    return fail(400, "INVALID_BODY", "Informe external_reference (1-100 caracteres: letras, números, ponto, hífen ou sublinhado).");
  const externalReference = parsed.data.external_reference;
  const selection = productSchema.safeParse(rawBody);
  if (!selection.success)
    return fail(400, "INVALID_BODY", "product, quando enviado, deve ter 1-120 caracteres: letras, números, ponto, hífen ou sublinhado.");

  // 4. Idempotência: referência já usada -> resultado anterior, sem novo débito.
  const previous = await db.accountLedgerEntry.findFirst({
    where: { userId, externalReference, type: AccountLedgerEntryType.PURCHASE },
    select: { id: true, amountCents: true, externalReference: true, note: true },
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

  // 6. Produto
  const resolved = await resolveProduct(db, selection.data.product);
  const fulfiller = resolved && fulfillerFor(deps, resolved.providerCode);
  if (!resolved || !fulfiller) return fail(400, "INVALID_PRODUCT", "Produto não disponível na API de revenda.");

  // 7. E-mail do cliente final (só validado quando o produto exige: no ticket
  // o campo continua ignorado, como antes)
  let email: string | null = null;
  if (fulfiller.requiresEmail) {
    const emailParsed = emailSchema.safeParse((rawBody as { email?: unknown }).email);
    if (!emailParsed.success) return fail(400, "INVALID_EMAIL", "Informe um e-mail válido do cliente final em email.");
    email = emailParsed.data;
  }

  // 8. Integração configurada
  if (!fulfiller.configured())
    return fail(503, "RESELLER_INTEGRATION_NOT_CONFIGURED", "Integração de revenda ainda não configurada.");

  // 9. Preço de revenda
  const priceCents = resolved.priceCents;
  if (!priceCents || priceCents < 1)
    return fail(409, "PRODUCT_NOT_AVAILABLE_FOR_RESALE", "Produto indisponível para revenda.");

  // 10. Débito (trava a linha de saldo; reconfere referência e saldo lá dentro)
  const bought: Bought = {
    providerCode: resolved.providerCode,
    externalProductId: resolved.externalProductId,
    email,
  };
  let purchase: { entry: PurchaseEntry & { balanceAfterCents: number }; created: boolean };
  try {
    purchase = await db.$transaction((tx) =>
      debitPurchase(tx, { userId, externalReference, amountCents: priceCents, note: resellerNote(bought) }),
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

  const orderId = resellerOrderId(purchase.entry.id);
  return fulfill(purchase.entry, { ...bought, orderId, metadata: resolved.metadata }, fulfiller, userId, deps, log, false);
}

async function fulfill(
  entry: PurchaseEntry,
  purchase: ResellerPurchase,
  fulfiller: ResellerFulfiller,
  userId: string,
  deps: ResellerApiDeps,
  log: NonNullable<ResellerApiDeps["log"]>,
  isReplay: boolean,
) {
  const chargedCents = Math.abs(entry.amountCents);
  const context = { userId, entryId: entry.id, provider: purchase.providerCode };
  let result: ProviderOrderResult | null = null;
  try {
    const adapter = fulfiller.adapter(purchase);
    const { orderId } = purchase;
    // Replay: consulta primeiro. Só se o fornecedor não conhecer a chave é que
    // a geração é pedida, com a MESMA idempotency_key — o débito já foi pago e
    // o próprio AdClean impede emissão duplicada.
    if (isReplay) {
      const found = await adapter.getOrderStatus(adapter.buildReconciliationIdentity?.(orderId) ?? orderId);
      if (!fulfiller.isUnknownOnReplay?.(found)) result = found;
    }
    result ??= await adapter.createOrder({
      providerProductId: purchase.externalProductId,
      reference: entry.id,
      payload: { orderId, paidAmountCents: chargedCents },
    });
  } catch (error) {
    if (!fulfiller.isDefinitiveFailure(error)) {
      log("[reseller] resultado incerto do fornecedor; sem estorno.", { ...context, code: errorCode(error) });
      return processing(entry, chargedCents);
    }
    log("[reseller] falha definitiva do fornecedor; estornando.", { ...context, code: errorCode(error) });
    return refundAndFail(entry, userId, deps, chargedCents, fulfiller.failedCode);
  }

  const body = result.status === "COMPLETED" ? fulfiller.completedBody(result, purchase) : null;
  if (body) {
    const balance = await deps.db.accountBalance.findUnique({ where: { userId }, select: { balanceCents: true } });
    return json(200, {
      ok: true,
      status: "COMPLETED",
      replay: isReplay,
      external_reference: entry.externalReference,
      ...body,
      charged_cents: chargedCents,
      balance_cents: balance?.balanceCents ?? null,
    });
  }
  if (result.status === "FAILED" && !isReplay) {
    log("[reseller] fornecedor devolveu FAILED; estornando.", { ...context, code: result.error ?? "FAILED" });
    return refundAndFail(entry, userId, deps, chargedCents, fulfiller.failedCode);
  }
  return processing(entry, chargedCents);
}

async function replay(
  entry: PurchaseEntry,
  userId: string,
  deps: ResellerApiDeps,
  log: NonNullable<ResellerApiDeps["log"]>,
) {
  // Vale o que foi comprado originalmente (note), não o corpo do reenvio.
  const bought = parseResellerNote(entry.note);
  const fulfiller = fulfillerFor(deps, bought.providerCode);
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
      code: fulfiller?.failedCode ?? "TICKET_FAILED_REFUNDED",
      error: "A emissão falhou e o valor foi estornado ao saldo. Use uma nova external_reference para tentar de novo.",
      external_reference: entry.externalReference,
    });
  if (!fulfiller?.configured())
    return fail(503, "RESELLER_INTEGRATION_NOT_CONFIGURED", "Integração de revenda ainda não configurada.");
  // metadata (ex.: periodo_horas) vem do ProviderProduct atual, como no Order da loja.
  const metadata = fulfiller.requiresEmail
    ? ((
        await deps.db.providerProduct.findFirst({
          where: { externalProductId: bought.externalProductId, provider: { code: bought.providerCode } },
          select: { metadata: true },
        })
      )?.metadata ?? null)
    : null;
  const orderId = resellerOrderId(entry.id);
  return fulfill(entry, { ...bought, orderId, metadata }, fulfiller, userId, deps, log, true);
}

async function refundAndFail(
  entry: PurchaseEntry,
  userId: string,
  deps: ResellerApiDeps,
  chargedCents: number,
  failedCode: string,
) {
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
    code: failedCode,
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
