import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { generateResellerApiKey } from "@/lib/reseller-keys";

type Db = Pick<PrismaClient, "user" | "accountBalance" | "resellerApiKey">;

export const balanceToggleSchema = z.object({ enabled: z.boolean() });
export const issueKeySchema = z.object({ label: z.string().trim().max(80).optional() });

// Toggle "Saldo habilitado" do Admin. Este é um dos pontos em que a linha de
// AccountBalance é criada (sob demanda): se não existir, nasce com
// balanceCents=0 e o enabled pedido. Nunca altera balanceCents.
export async function setAccountBalanceEnabled(db: Db, userId: string, enabled: boolean) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false as const, code: "USER_NOT_FOUND" };
  const balance = await db.accountBalance.upsert({
    where: { userId },
    update: { enabled },
    create: { userId, enabled },
    select: { enabled: true, balanceCents: true },
  });
  return { ok: true as const, balance };
}

// Emissão de chave: só para conta RESELLER ativa. Devolve a chave em texto
// puro UMA única vez; o banco guarda apenas o hash.
export async function issueResellerKey(db: Db, userId: string, label?: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, active: true } });
  if (!user) return { ok: false as const, code: "USER_NOT_FOUND" };
  if (user.role !== "RESELLER" || !user.active) return { ok: false as const, code: "RESELLER_REQUIRED" };
  const { plaintext, tokenHash } = generateResellerApiKey();
  const key = await db.resellerApiKey.create({
    data: { userId, tokenHash, label: label || null },
    select: { id: true, label: true, createdAt: true },
  });
  return { ok: true as const, key, plaintext };
}

// Revogação: mantém a linha (histórico), marca active=false e revokedAt.
// Idempotente: revogar de novo não muda revokedAt.
export async function revokeResellerKey(db: Db, userId: string, keyId: string, now = new Date()) {
  const key = await db.resellerApiKey.findFirst({
    where: { id: keyId, userId },
    select: { id: true, revokedAt: true },
  });
  if (!key) return { ok: false as const, code: "KEY_NOT_FOUND" };
  if (key.revokedAt) return { ok: true as const, alreadyRevoked: true };
  await db.resellerApiKey.update({ where: { id: key.id }, data: { active: false, revokedAt: now } });
  return { ok: true as const, alreadyRevoked: false };
}
