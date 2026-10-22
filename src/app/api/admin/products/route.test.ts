import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  db: { category: { findUnique: vi.fn() }, product: { create: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/pricing-service", () => ({
  loadPricingContext: vi.fn(async () => ({})),
  calculateProductPricing: vi.fn(() => null),
  pricingUpdateData: vi.fn(() => ({})),
}));
vi.mock("@/lib/admin-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin-catalog")>()),
  adminProductDto: vi.fn(() => ({ id: "p-new" })),
}));
import { POST } from "./route";

const body = (overrides: Record<string, unknown> = {}) => ({
  name: "Octoplus", slug: "octoplus", description: "Aluguel", type: "RENTAL", deliveryType: "AUTOMATIC",
  priceCents: 4500, priceVisibility: "PUBLIC", normalPriceCents: 4500, pricingMode: "MANUAL", manualPriceCents: 4500,
  categoryId: "cat-1", status: "DRAFT", available: true, ...overrides,
});
const post = (payload: unknown) =>
  POST(new Request("https://test/api/admin/products", { method: "POST", body: JSON.stringify(payload) }));

describe("POST /api/admin/products — bloqueio de publicação sem produto do fornecedor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.category.findUnique.mockResolvedValue({ id: "cat-1" });
    const created = { id: "p-new", name: "Octoplus", status: "DRAFT", priceCents: 4500, pricingMode: "MANUAL" };
    db.product.create.mockResolvedValue(created);
    db.product.update.mockResolvedValue(created);
  });

  it("recusa criar já PUBLISHED com entrega AUTOMATIC (produto novo não tem vínculo)", async () => {
    const response = await post(body({ status: "PUBLISHED" }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/^Falta o produto do fornecedor/);
    expect(db.product.create).not.toHaveBeenCalled();
  });

  it("cria AUTOMATIC como rascunho", async () => {
    expect((await post(body())).status).toBe(201);
    expect(db.product.create).toHaveBeenCalledOnce();
  });

  it("cria PUBLISHED com entrega sob consulta (regra atual)", async () => {
    expect((await post(body({ status: "PUBLISHED", deliveryType: "ON_REQUEST" }))).status).toBe(201);
  });
});
