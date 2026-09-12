import type { ProviderCatalogItem } from "./types";
import type { Prisma } from "@prisma/client";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as JsonRecord : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function moneyToCents(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
}

function fields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const name = text(item?.name);
    if (!item || !name) return [];
    return [{
      name,
      type: text(item.type) ?? null,
      required: typeof item.required === "boolean" ? item.required : null,
      base: typeof item.base === "boolean" ? item.base : null,
    }];
  });
}

export function parseHeartUnlocksCatalogResponse(payload: unknown): ProviderCatalogItem[] {
  const root = record(payload);
  const data = record(root?.data);
  const products = record(data?.products);
  if (!root || root.status !== "success" || !data || !products) {
    throw new Error("HEARTUNLOCKS_INVALID_CATALOG_RESPONSE");
  }
  const rootCurrency = text(data.currency)?.toUpperCase();
  const categories = record(data.categories);
  return Object.entries(products).map(([productId, entry], index) => {
    const item = record(entry);
    const externalProductId = text(productId);
    const label = text(item?.name);
    if (!item || !externalProductId || !label) {
      throw new Error(`HEARTUNLOCKS_INVALID_CATALOG_ITEM_${index}`);
    }
    const currency = text(item.currency)?.toUpperCase() ?? rootCurrency;
    const requiredFields = fields(item.fields);
    const cids = Array.isArray(item.cids) ? item.cids.map(text).filter((value): value is string => !!value) : [];
    const categoryId = text(item.cid) ?? null;
    const category = categoryId ? record(categories?.[categoryId]) : null;
    const metadata = {
      providerType: text(item.type) ?? null,
      categoryId,
      categoryName: text(category?.name) ?? null,
      categoryIds: cids,
      providerTime: text(item.time) ?? null,
      providerStatus: text(item.status) ?? null,
      requiredFields,
      providerImageUrl: text(item.image_url) ?? null,
      providerDescription: text(item.description) ?? null,
    };
    return {
      externalProductId,
      label,
      costCents: moneyToCents(item.price),
      currency,
      providerTime: metadata.providerTime,
      type: metadata.providerType,
      status: metadata.providerStatus,
      requiredFields,
      metadata,
    };
  });
}

export function providerCatalogSyncData(item: ProviderCatalogItem, syncedAt: Date) {
  const update: Prisma.ProviderProductUpdateInput = {
    label: item.label,
    metadata: item.metadata as Prisma.InputJsonValue,
    lastSyncedAt: syncedAt,
    syncStatus: "SYNCED",
  };
  if (item.costCents !== undefined) update.providerCostCents = item.costCents;
  if (item.currency) update.currency = item.currency;
  return update;
}
