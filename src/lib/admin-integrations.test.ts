import { describe, expect, it } from "vitest";
import { providerOperationAuditMetadata } from "./admin-provider-operation";

describe("provider operation audit", () => {
  it("records the previous and requested operational state", () => {
    expect(providerOperationAuditMetadata(false, true)).toEqual({
      previousActive: false,
      active: true,
    });
  });
});
