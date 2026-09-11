import { describe, expect, it } from "vitest";
import { ProductType } from "@prisma/client";
import { canReadOrder, parsePublicProductType, safeNextPath } from "./public-navigation";

describe("public navigation", () => {
  it("maps friendly catalog filters to real product types", () => {
    expect(parsePublicProductType("aluguéis")).toBe(ProductType.RENTAL);
    expect(parsePublicProductType("licenca")).toBe(ProductType.LICENSE);
    expect(parsePublicProductType("serviços")).toBe(ProductType.REMOTE_SERVICE);
    expect(parsePublicProductType("unknown")).toBeUndefined();
  });

  it("accepts only local post-login destinations", () => {
    expect(safeNextPath("/catalogo?q=amt")).toBe("/catalogo?q=amt");
    expect(safeNextPath("//example.com")).toBe("/meus-pedidos");
    expect(safeNextPath("https://example.com")).toBe("/meus-pedidos");
  });

  it("limits orders to their owner while preserving admin access", () => {
    expect(canReadOrder({ id: "owner", role: "USER" }, "owner")).toBe(true);
    expect(canReadOrder({ id: "other", role: "USER" }, "owner")).toBe(false);
    expect(canReadOrder({ id: "admin", role: "ADMIN" }, "owner")).toBe(true);
  });
});
