import { ProductStatus } from "@prisma/client";
import { z } from "zod";

export const bulkProductSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["PUBLISH", "DRAFT", "PAUSE", "ARCHIVE", "APPLY_GLOBAL", "APPLY_GROUP", "REMOVE_MANUAL", "RECALCULATE"]),
});

export const bulkStatus = (action: z.infer<typeof bulkProductSchema>["action"]) => ({
  PUBLISH: ProductStatus.PUBLISHED,
  DRAFT: ProductStatus.DRAFT,
  PAUSE: ProductStatus.PAUSED,
  ARCHIVE: ProductStatus.ARCHIVED,
} as const)[action as "PUBLISH" | "DRAFT" | "PAUSE" | "ARCHIVE"];

export const isPricingBulkAction = (action: z.infer<typeof bulkProductSchema>["action"]) =>
  ["APPLY_GLOBAL", "APPLY_GROUP", "REMOVE_MANUAL", "RECALCULATE"].includes(action);

export const pricingModeForBulkAction = (action: z.infer<typeof bulkProductSchema>["action"]) =>
  action === "APPLY_GROUP" ? "AUTO_GROUP" as const : action === "RECALCULATE" ? null : "AUTO_GLOBAL" as const;
