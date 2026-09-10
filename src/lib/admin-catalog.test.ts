import { describe, expect, it } from "vitest";
import { ProductStatus, ProductType } from "@prisma/client";
import { productInputSchema } from "./admin-catalog";
import { assertAdminRole, isAdminRole } from "./authorization";

const validProduct = {
  name: "UnlockTool", slug: "unlocktool", description: "Ferramenta para técnicos",
  type: ProductType.TOOL, duration: null, priceCents: 2900, categoryId: "category-1",
  imageUrl: "", status: ProductStatus.DRAFT, available: true,
};

describe("validação administrativa de produto", () => {
  it("rejeita nome vazio", () => expect(productInputSchema.safeParse({ ...validProduct, name: "" }).success).toBe(false));
  it("rejeita preço negativo", () => expect(productInputSchema.safeParse({ ...validProduct, priceCents: -1 }).success).toBe(false));
  it("aceita um produto válido", () => expect(productInputSchema.safeParse(validProduct).success).toBe(true));
});

describe("autorização administrativa", () => {
  it("rejeita USER", () => { expect(isAdminRole("USER")).toBe(false); expect(() => assertAdminRole("USER")).toThrow("FORBIDDEN"); });
  it("autoriza ADMIN", () => { expect(isAdminRole("ADMIN")).toBe(true); expect(() => assertAdminRole("ADMIN")).not.toThrow(); });
});
