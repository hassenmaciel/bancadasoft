import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const counts = { product: vi.fn(), brand: vi.fn(), homeBanner: vi.fn() };
vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: { count: (a: unknown) => counts.product(a) },
    brand: { count: (a: unknown) => counts.brand(a) },
    homeBanner: { count: (a: unknown) => counts.homeBanner(a) },
  },
}));

const { POST, DELETE } = await import("./route");

const form = (kind: string, file: File) => {
  const data = new FormData();
  data.set("kind", kind);
  data.set("file", file);
  return new Request("http://localhost/api/admin/assets", { method: "POST", body: data });
};
const image = (bytes = 1024, type = "image/webp") => new File([new Uint8Array(bytes)], "a", { type });

const SECRET = "sb_secret_test_key_should_never_leak";
const configured = () => {
  vi.stubEnv("SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SECRET);
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "catalog-assets");
};

beforeEach(() => {
  requireAdmin.mockResolvedValue({ id: "admin-1" });
  for (const c of Object.values(counts)) c.mockResolvedValue(0);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/admin/assets", () => {
  it("rejeita não-admin com 403 antes de ler o arquivo", async () => {
    requireAdmin.mockRejectedValue(new Error("forbidden"));
    expect((await POST(form("banners", image()))).status).toBe(403);
  });

  it("sem SUPABASE_URL/SERVICE_ROLE_KEY responde 503 'Storage não configurado.' (igual para products e banners)", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    for (const kind of ["products", "banners"]) {
      const response = await POST(form(kind, image()));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe("Storage não configurado.");
    }
  });

  it("aceita kind=banners: envia para banners/<uuid>.webp no bucket configurado e não vaza a chave", async () => {
    configured();
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await POST(form("banners", image(1024, "image/webp")));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text).data.url).toMatch(/^https:\/\/abcdefgh\.supabase\.co\/storage\/v1\/object\/public\/catalog-assets\/banners\/[0-9a-f-]{36}\.webp$/);
    expect(text).not.toContain(SECRET);
    const upload = fetcher.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(String(upload?.[0])).toContain("/storage/v1/object/catalog-assets/banners/");
  });

  it("mantém products funcionando", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const response = await POST(form("products", image(1024, "image/png")));
    expect(response.status).toBe(200);
    expect((await response.json()).data.url).toContain("/products/");
  });

  it("rejeita arquivo > 500 KB, formato inválido e kind desconhecido (422)", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect((await POST(form("banners", image(500 * 1024 + 1)))).status).toBe(422);
    expect((await POST(form("banners", image(1024, "image/gif")))).status).toBe(422);
    expect((await POST(form("banners", image(1024, "image/svg+xml")))).status).toBe(422);
    expect((await POST(form("outro", image()))).status).toBe(422);
  });

  it("aceita exatamente 500 KB", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect((await POST(form("banners", image(500 * 1024, "image/jpeg")))).status).toBe(200);
  });
});

describe("DELETE /api/admin/assets", () => {
  const ASSET = "https://abcdefgh.supabase.co/storage/v1/object/public/catalog-assets/banners/11111111-1111-1111-1111-111111111111.jpg";
  const del = (url: unknown) =>
    new Request("http://localhost/api/admin/assets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });

  it("rejeita não-admin com 403", async () => {
    requireAdmin.mockRejectedValue(new Error("forbidden"));
    expect((await DELETE(del(ASSET))).status).toBe(403);
  });

  it.each(["product", "brand", "homeBanner"] as const)(
    "recusa com 409 e não chama o Storage quando o arquivo é referenciado por %s",
    async (table) => {
      configured();
      counts[table].mockResolvedValue(1);
      const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetcher);
      const response = await DELETE(del(ASSET));
      expect(response.status).toBe(409);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("remove arquivo não referenciado (upload ainda não salvo)", async () => {
    configured();
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await DELETE(del(ASSET));
    expect(response.status).toBe(200);
    expect((await response.json()).data.removed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
