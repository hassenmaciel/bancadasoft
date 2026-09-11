import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export function audit(actorUserId: string, action: string, entityType: string, entityId?: string, metadata?: Prisma.InputJsonValue) {
  return prisma.auditLog.create({ data: { actorUserId, action, entityType, entityId, metadata } });
}

export function safeChangeMetadata(before: Record<string, unknown>, after: Record<string, unknown>) {
  const blocked = /password|secret|token|credential|pix|key/i;
  return Object.fromEntries(Object.keys(after).filter((key) => !blocked.test(key) && before[key] !== after[key]).map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
}
