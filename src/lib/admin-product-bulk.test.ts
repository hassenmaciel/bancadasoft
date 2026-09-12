import { describe, expect, it } from "vitest";
import { bulkProductSchema, bulkStatus } from "./admin-product-bulk";

describe("admin bulk publication", () => {
  it.each([["PUBLISH", "PUBLISHED"], ["DRAFT", "DRAFT"], ["PAUSE", "PAUSED"], ["ARCHIVE", "ARCHIVED"]] as const)("maps %s", (action, status) => expect(bulkStatus(action)).toBe(status));
  it("requires an explicit bounded selection", () => {
    expect(bulkProductSchema.safeParse({ ids: [], action: "PUBLISH" }).success).toBe(false);
    expect(bulkProductSchema.safeParse({ ids: ["p1"], action: "PUBLISH" }).success).toBe(true);
  });
});
