import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// `client` permite gravar a auditoria dentro de uma transação (tx) já aberta.
export function audit(actorUserId: string, action: string, entityType: string, entityId?: string, metadata?: Prisma.InputJsonValue, client: Pick<Prisma.TransactionClient, "auditLog"> = prisma) {
  return client.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata } });
}

export function safeChangeMetadata(before: Record<string, unknown>, after: Record<string, unknown>) {
  const blocked = /password|secret|token|credential|pix|key/i;
  return Object.fromEntries(Object.keys(after).filter((key) => !blocked.test(key) && before[key] !== after[key]).map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
}
