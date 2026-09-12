import { ProductStatus } from "@prisma/client";
import { z } from "zod";

export const bulkProductSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["PUBLISH", "DRAFT", "PAUSE", "ARCHIVE"]),
});

export const bulkStatus = (action: z.infer<typeof bulkProductSchema>["action"]) => ({
  PUBLISH: ProductStatus.PUBLISHED,
  DRAFT: ProductStatus.DRAFT,
  PAUSE: ProductStatus.PAUSED,
  ARCHIVE: ProductStatus.ARCHIVED,
})[action];
