import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { ProviderCatalogItem } from "./types";
import { resolveProviderAdapter } from "./registry";
import { providerCatalogSyncData } from "./heartunlocks-catalog";

export async function syncProviderCatalog(providerId: string, actorUserId: string) {
  const provider = await prisma.provider.findUnique({ where: { id: providerId }, select: { id: true, code: true } });
  if (!provider) throw new Error("PROVIDER_NOT_FOUND");
  const adapter = resolveProviderAdapter(provider.code);
  if (!adapter) throw new Error("PROVIDER_ADAPTER_NOT_FOUND");

  let catalog: ProviderCatalogItem[];
  try {
    catalog = await adapter.listProducts();
  } catch {
    await prisma.auditLog.create({ data: { actorUserId, action: "PROVIDER_CATALOG_SYNC_FAILED", entityType: "Provider", entityId: provider.id, metadata: { reason: "UPSTREAM_UNAVAILABLE" } } });
    throw new Error("PROVIDER_CATALOG_SYNC_FAILED");
  }
  const syncedAt = new Date();
  const existing = await prisma.providerProduct.findMany({ where: { providerId }, select: { externalProductId: true, productId: true } });
  const byExternalId = new Map(existing.map((item) => [item.externalProductId, item]));
  let created = 0;
  let updated = 0;
  let unlinked = 0;

  const operations = catalog.map((item) => {
    const current = byExternalId.get(item.externalProductId);
    const update = providerCatalogSyncData(item, syncedAt);
    if (current) {
      updated += 1;
      if (!current.productId) unlinked += 1;
      return prisma.providerProduct.update({ where: { providerId_externalProductId: { providerId, externalProductId: item.externalProductId } }, data: update });
    }
    created += 1;
    unlinked += 1;
    return prisma.providerProduct.create({
      data: {
          providerId,
          externalProductId: item.externalProductId,
          label: item.label,
          providerCostCents: item.costCents ?? null,
          currency: item.currency ?? "UNSPECIFIED",
          active: true,
          mode: "REAL",
          metadata: item.metadata as Prisma.InputJsonValue,
          lastSyncedAt: syncedAt,
          syncStatus: "SYNCED",
      },
    });
  });
  await prisma.$transaction([...operations, prisma.auditLog.create({ data: {
      actorUserId,
      action: "PROVIDER_CATALOG_SYNC_SUCCEEDED",
      entityType: "Provider",
      entityId: provider.id,
      metadata: { found: catalog.length, created, updated, unlinked, syncedAt: syncedAt.toISOString() },
  } })]);
  return { found: catalog.length, created, updated, unlinked, syncedAt: syncedAt.toISOString() };
}
