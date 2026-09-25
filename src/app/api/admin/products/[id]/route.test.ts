import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  db: { product: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), safeChangeMetadata: vi.fn(() => ({})) }));
vi.mock("@/lib/admin-storage", () => ({ removeAdminAsset: vi.fn() }));
vi.mock("@/lib/pricing-service", () => ({
  loadPricingContext: vi.fn(async () => ({})),
  calculateProductPricing: vi.fn(() => null),
  pricingUpdateData: vi.fn(() => ({})),
}));
import { PUT } from "./route";

const now = new Date("2026-09-25T12:00:00Z");
const stored = (resellerPriceCents: number | null) => ({
  id: "p1", slug: "adclean", name: "AdClean", description: "Ticket", longDescription: null, type: "TOOL", deliveryType: "AUTOMATIC",
  deliveryEstimate: null, searchTerms: "", duration: null, imageUrl: null, downloadUrl: null, downloadLabel: null,
  priceCents: 2000, priceVisibility: "LOGIN_REQUIRED", normalPriceCents: 2000, premiumPriceCents: 1000, resellerPriceCents,
  costCents: null, pricingMode: "MANUAL", manualPriceCents: 2000, suggestedPriceCents: null, pricingStatus: "MANUAL",
  pricingComputedAt: null, featured: false, sortOrder: 0, status: "DRAFT", available: false, categoryId: "cat-1", brandId: null,
  createdAt: now, updatedAt: now, category: { id: "cat-1", name: "Ferramentas", slug: "ferramentas" }, brand: null,
  providerProducts: [], variants: [],
});
const body = (resellerPriceCents: number | null) => ({
  name: "AdClean", slug: "adclean", description: "Ticket", type: "TOOL", deliveryType: "AUTOMATIC",
  priceCents: 2000, priceVisibility: "LOGIN_REQUIRED", normalPriceCents: 2000, premiumPriceCents: 1000,
  resellerPriceCents, pricingMode: "MANUAL", manualPriceCents: 2000, categoryId: "cat-1", status: "DRAFT", available: false,
});
const put = (payload: unknown) =>
  PUT(new Request("https://test/api/admin/products/p1", { method: "PUT", body: JSON.stringify(payload) }), {
    params: Promise.resolve({ id: "p1" }),
  });

describe("PUT /api/admin/products/[id] — Preço de revenda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [] });
  });

  it.each([2500, null])("grava resellerPriceCents=%s e o devolve no DTO", async (value) => {
    db.product.update.mockResolvedValue(stored(value));
    const response = await put(body(value));
    expect(response.status).toBe(200);
    expect(db.product.update.mock.calls[0][0].data).toMatchObject({ resellerPriceCents: value });
    expect((await response.json()).data.resellerPriceCents).toBe(value);
  });

  it("recusa preço de revenda inválido sem gravar", async () => {
    const response = await put(body(0));
    expect(response.status).toBe(422);
    expect(db.product.update).not.toHaveBeenCalled();
  });
});
