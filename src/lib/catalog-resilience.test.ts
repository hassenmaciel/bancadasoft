import { describe, expect, it } from "vitest";
import { withEditorialFallback } from "./catalog-search";

describe("resiliência da Home", () => {
  it("usa destaque editorial quando o groupBy de vendas falha", async () => {
    const logs: unknown[][] = [];
    const featured = [{ id: "featured" }];
    const result = await withEditorialFallback(
      async () => { throw new Error("PrismaClientInitializationError"); },
      async () => featured,
      (...args) => logs.push(args),
    );
    expect(result).toEqual({ source: "featured", products: featured });
    expect(logs).toHaveLength(1);
  });

  it("não inventa vendas quando as consultas auxiliares falham", async () => {
    const result = await withEditorialFallback(
      async () => { throw new Error("groupBy failed"); },
      async () => { throw new Error("fallback failed"); },
      () => undefined,
    );
    expect(result).toEqual({ source: "empty", products: [] });
  });
});
