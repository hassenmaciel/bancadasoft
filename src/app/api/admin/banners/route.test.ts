import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const tx = { homeBanner: { count: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } };
const prisma = {
  homeBanner: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[]))),
};
vi.mock("@/lib/auth", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/admin-storage", () => ({ removeAdminAsset: vi.fn().mockResolvedValue(true) }));

const { GET, POST } = await import("./route");
const { PUT, DELETE } = await import("./[id]/route");

const body = { title: "Promo", imageUrl: "https://x.supabase.co/storage/v1/object/public/b/banners/a.webp", linkUrl: "/catalogo", sortOrder: 1, active: true };
const req = (payload: unknown) => new Request("http://localhost/api/admin/banners", { method: "POST", body: JSON.stringify(payload) });
const ctx = { params: Promise.resolve({ id: "b1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ id: "admin-1" });
  tx.homeBanner.count.mockResolvedValue(0);
  tx.homeBanner.create.mockImplementation(async ({ data }) => ({ id: "b1", ...data }));
  tx.homeBanner.findUnique.mockResolvedValue({ id: "b1", imageUrl: body.imageUrl });
  tx.homeBanner.update.mockImplementation(async ({ data }) => ({ id: "b1", ...data }));
  prisma.homeBanner.findUnique.mockResolvedValue({ id: "b1", title: "Promo", imageUrl: body.imageUrl });
});

describe("autorização admin", () => {
  it("bloqueia todas as rotas sem admin (403) e não toca no banco", async () => {
    requireAdmin.mockRejectedValue(new Error("forbidden"));
    const responses = [await GET(), await POST(req(body)), await PUT(req(body), ctx), await DELETE(req(body), ctx)];
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect(prisma.homeBanner.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/banners", () => {
  it("cria banner válido e audita", async () => {
    const response = await POST(req(body));
    expect(response.status).toBe(201);
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it("impede o 5º banner ativo (409) mas permite criar inativo", async () => {
    tx.homeBanner.count.mockResolvedValue(4);
    expect((await POST(req(body))).status).toBe(409);
    expect(tx.homeBanner.create).not.toHaveBeenCalled();
    expect((await POST(req({ ...body, active: false }))).status).toBe(201);
  });
  it("rejeita link inseguro e imagem ausente (422)", async () => {
    expect((await POST(req({ ...body, linkUrl: "javascript:alert(1)" }))).status).toBe(422);
    expect((await POST(req({ ...body, imageUrl: "" }))).status).toBe(422);
  });
});

describe("PUT/DELETE /api/admin/banners/[id]", () => {
  it("edita, e bloqueia ativar quando já há 4 outros ativos", async () => {
    expect((await PUT(req(body), ctx)).status).toBe(200);
    tx.homeBanner.count.mockResolvedValue(4);
    expect((await PUT(req(body), ctx)).status).toBe(409);
    expect((await PUT(req({ ...body, active: false }), ctx)).status).toBe(200);
  });
  it("404 quando não existe", async () => {
    tx.homeBanner.findUnique.mockResolvedValue(null);
    expect((await PUT(req(body), ctx)).status).toBe(404);
    prisma.homeBanner.findUnique.mockResolvedValue(null);
    expect((await DELETE(req(body), ctx)).status).toBe(404);
  });
  it("exclui", async () => {
    expect((await DELETE(req(body), ctx)).status).toBe(200);
    expect(prisma.homeBanner.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
  });
});
