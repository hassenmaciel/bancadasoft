import { describe, expect, it, vi } from "vitest";
import { isAssetReferenced } from "./asset-references";

const db = (p = 0, b = 0, h = 0) => ({
  product: { count: vi.fn().mockResolvedValue(p) },
  brand: { count: vi.fn().mockResolvedValue(b) },
  homeBanner: { count: vi.fn().mockResolvedValue(h) },
});

describe("isAssetReferenced", () => {
  it.each([
    ["Product", db(1, 0, 0)],
    ["Brand", db(0, 1, 0)],
    ["HomeBanner", db(0, 0, 1)],
  ])("true quando referenciada por %s", async (_name, client) => {
    expect(await isAssetReferenced("https://x/a.jpg", client)).toBe(true);
    expect(client.product.count).toHaveBeenCalledWith({ where: { imageUrl: "https://x/a.jpg" } });
  });
  it("false quando ninguém referencia", async () => {
    expect(await isAssetReferenced("https://x/a.jpg", db())).toBe(false);
  });
});
