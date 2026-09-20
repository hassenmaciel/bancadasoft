import { afterEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_CACHE_CONTROL, uploadAdminAsset } from "./admin-storage";

describe("uploadAdminAsset cache headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends a long-lived public cache-control on new uploads", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    await uploadAdminAsset({ file, kind: "products", fetcher: fetcher as unknown as typeof fetch });
    const upload = fetcher.mock.calls.map((c) => c as unknown as [string, RequestInit]).find(([, init]) => init?.method === "POST" && String(init.body).length !== 0 && (init.headers as Record<string, string>)["x-upsert"]);
    expect((upload![1].headers as Record<string, string>)["cache-control"]).toBe("public, max-age=31536000");
    expect(UPLOAD_CACHE_CONTROL).toBe("public, max-age=31536000");
  });
});
