import { describe, expect, it } from "vitest";
import { isOptimizableImage } from "./image-source";

describe("isOptimizableImage", () => {
  it("optimizes only public Supabase storage images", () => {
    expect(isOptimizableImage("https://abc123.supabase.co/storage/v1/object/public/catalog-assets/products/a.png")).toBe(true);
  });
  it("keeps other origins unoptimized", () => {
    expect(isOptimizableImage("https://example.com/a.png")).toBe(false);
    expect(isOptimizableImage("http://abc123.supabase.co/storage/v1/object/public/x/a.png")).toBe(false);
    expect(isOptimizableImage("https://abc123.supabase.co/rest/v1/x")).toBe(false);
    expect(isOptimizableImage("https://abc123.supabase.co.evil.com/storage/v1/object/public/x/a.png")).toBe(false);
    expect(isOptimizableImage("data:image/png;base64,AAAA")).toBe(false);
    expect(isOptimizableImage("not a url")).toBe(false);
    expect(isOptimizableImage(null)).toBe(false);
  });
});
