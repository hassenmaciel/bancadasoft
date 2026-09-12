import { describe, expect, it } from "vitest";
import { bulkProductSchema, bulkStatus, pricingModeForBulkAction } from "./admin-product-bulk";

describe("admin bulk publication", () => {
  it.each([["PUBLISH", "PUBLISHED"], ["DRAFT", "DRAFT"], ["PAUSE", "PAUSED"], ["ARCHIVE", "ARCHIVED"]] as const)("maps %s", (action, status) => expect(bulkStatus(action)).toBe(status));
  it("requires an explicit bounded selection", () => {
    expect(bulkProductSchema.safeParse({ ids: [], action: "PUBLISH" }).success).toBe(false);
    expect(bulkProductSchema.safeParse({ ids: ["p1"], action: "PUBLISH" }).success).toBe(true);
  });
});

describe("bulk pricing actions", () => {
  it("requires an explicit action to remove manual pricing", () => {
    expect(pricingModeForBulkAction("RECALCULATE")).toBeNull();
    expect(pricingModeForBulkAction("REMOVE_MANUAL")).toBe("AUTO_GLOBAL");
  });
  it("selects global and group modes deterministically", () => {
    expect(pricingModeForBulkAction("APPLY_GLOBAL")).toBe("AUTO_GLOBAL");
    expect(pricingModeForBulkAction("APPLY_GROUP")).toBe("AUTO_GROUP");
  });
});
