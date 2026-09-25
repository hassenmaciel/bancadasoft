import { AccountLedgerEntryType, Prisma } from "@prisma/client";

// Saldo pré-pago por conta. Regras invariantes deste módulo:
// - AccountBalance.balanceCents é o saldo materializado; AccountLedgerEntry é
//   o histórico imutável (só INSERT, nunca UPDATE/DELETE) e cada lançamento
//   grava balanceAfterCents.
// - Toda alteração de saldo acontece numa transação que primeiro trava a
//   linha de AccountBalance (SELECT ... FOR UPDATE). Isso serializa crédito,
//   débito e estorno do mesmo usuário e torna as checagens "já existe
//   lançamento?" e "saldo suficiente?" livres de corrida, mesmo antes do
//   índice único (userId, externalReference) estar aplicado no banco.
// - A linha de AccountBalance é criada sob demanda (ver ensureAccountBalance):
//   ausência de linha equivale a saldo 0 e uso desabilitado.

export type LockedBalance = { id: string; balanceCents: number; enabled: boolean };
type Tx = Prisma.TransactionClient;

export const REFUND_REFERENCE_PREFIX = "refund:";

export function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export class AccountBalanceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AccountBalanceError";
  }
}

// Cria a linha (saldo 0, enabled=false — os defaults do schema) se ainda não
// existir. Chamado só nos pontos que precisam dela: toggle do Admin, crédito de
// recarga e débito/estorno da API de revenda. Nunca na criação do usuário.
export async function ensureAccountBalance(tx: Tx, userId: string) {
  await tx.accountBalance.upsert({ where: { userId }, update: {}, create: { userId } });
}

export async function lockAccountBalance(tx: Tx, userId: string): Promise<LockedBalance> {
  await ensureAccountBalance(tx, userId);
  const rows = await tx.$queryRaw<LockedBalance[]>`
    SELECT "id", "balanceCents", "enabled" FROM "AccountBalance" WHERE "userId" = ${userId} FOR UPDATE`;
  if (!rows[0]) throw new AccountBalanceError("ACCOUNT_BALANCE_NOT_FOUND");
  return rows[0];
}

async function applyEntry(
  tx: Tx,
  locked: LockedBalance,
  entry: {
    userId: string;
    type: AccountLedgerEntryType;
    amountCents: number;
    sourceOrderId?: string;
    externalReference?: string;
    note?: string;
  },
) {
  const balanceAfterCents = locked.balanceCents + entry.amountCents;
  if (balanceAfterCents < 0) throw new AccountBalanceError("INSUFFICIENT_BALANCE");
  await tx.accountBalance.update({ where: { id: locked.id }, data: { balanceCents: balanceAfterCents } });
  return tx.accountLedgerEntry.create({ data: { ...entry, balanceAfterCents } });
}

// Crédito de recarga paga (Order via PIX). Idempotente por sourceOrderId: se o
// lançamento já existir, devolve-o sem creditar de novo.
export async function creditTopup(
  tx: Tx,
  input: { userId: string; orderId: string; amountCents: number; note?: string },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1)
    throw new AccountBalanceError("INVALID_CREDIT_AMOUNT");
  const locked = await lockAccountBalance(tx, input.userId);
  const existing = await tx.accountLedgerEntry.findUnique({ where: { sourceOrderId: input.orderId } });
  if (existing) return { entry: existing, created: false as const };
  const entry = await applyEntry(tx, locked, {
    userId: input.userId,
    type: AccountLedgerEntryType.TOPUP,
    amountCents: input.amountCents,
    sourceOrderId: input.orderId,
    note: input.note,
  });
  return { entry, created: true as const };
}

// Débito de compra via API de revenda. Idempotente por (userId,
// externalReference): se já existir, devolve o lançamento anterior sem debitar.
export async function debitPurchase(
  tx: Tx,
  input: { userId: string; externalReference: string; amountCents: number; note?: string },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 1)
    throw new AccountBalanceError("INVALID_DEBIT_AMOUNT");
  const locked = await lockAccountBalance(tx, input.userId);
  const existing = await tx.accountLedgerEntry.findFirst({
    where: { userId: input.userId, externalReference: input.externalReference },
  });
  if (existing) return { entry: existing, created: false as const };
  if (!locked.enabled) throw new AccountBalanceError("BALANCE_NOT_ENABLED");
  const entry = await applyEntry(tx, locked, {
    userId: input.userId,
    type: AccountLedgerEntryType.PURCHASE,
    amountCents: -input.amountCents,
    externalReference: input.externalReference,
    note: input.note,
  });
  return { entry, created: true as const };
}

// Estorno de um débito de revenda cuja falha é definitiva. A referência do
// estorno é "refund:<externalReference original>" — o formato aceito pela API
// para external_reference não permite ":", então não há colisão com uma
// referência enviada pelo revendedor. Idempotente pela mesma chave.
export async function refundPurchase(
  tx: Tx,
  input: { userId: string; purchaseEntryId: string; externalReference: string; amountCents: number; note?: string },
) {
  const locked = await lockAccountBalance(tx, input.userId);
  const refundReference = `${REFUND_REFERENCE_PREFIX}${input.externalReference}`;
  const existing = await tx.accountLedgerEntry.findFirst({
    where: { userId: input.userId, externalReference: refundReference },
  });
  if (existing) return { entry: existing, created: false as const };
  const entry = await applyEntry(tx, locked, {
    userId: input.userId,
    type: AccountLedgerEntryType.REFUND,
    amountCents: input.amountCents,
    externalReference: refundReference,
    note: input.note ?? `Estorno do lançamento ${input.purchaseEntryId}`,
  });
  return { entry, created: true as const };
}
