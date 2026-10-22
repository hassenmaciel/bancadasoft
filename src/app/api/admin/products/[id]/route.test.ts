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

describe("PUT /api/admin/products/[id] — tipo Recarga de saldo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [] });
  });

  it("grava type=BALANCE_TOPUP e o devolve no DTO", async () => {
    db.product.update.mockResolvedValue({ ...stored(null), type: "BALANCE_TOPUP" });
    const response = await put({ ...body(null), type: "BALANCE_TOPUP" });
    expect(response.status).toBe(200);
    expect(db.product.update.mock.calls[0][0].data).toMatchObject({ type: "BALANCE_TOPUP" });
    expect((await response.json()).data.type).toBe("BALANCE_TOPUP");
  });
});

describe("PUT /api/admin/products/[id] — bloqueio de publicação sem produto do fornecedor", () => {
  const link = { id: "pp1", productId: "p1", externalProductId: "2191", active: true, mode: "REAL", technicalEligibility: "READY", providerCostCents: 520, provider: { id: "hu", code: "heartunlocks", active: true } };
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.product.update.mockResolvedValue(stored(null));
  });

  it("recusa publicar AUTOMATIC sem vínculo, com mensagem clara e sem gravar", async () => {
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [], providerProducts: [] });
    const response = await put({ ...body(null), status: "PUBLISHED" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/^Falta o produto do fornecedor/);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it("publica AUTOMATIC com exatamente um vínculo elegível", async () => {
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [], providerProducts: [link] });
    expect((await put({ ...body(null), status: "PUBLISHED" })).status).toBe(200);
  });

  it("usa o tipo de entrega enviado: MANUAL sem vínculo publica", async () => {
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [], providerProducts: [] });
    expect((await put({ ...body(null), deliveryType: "MANUAL", status: "PUBLISHED" })).status).toBe(200);
  });

  it("produto com variantes mantém a regra atual", async () => {
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [{ active: false, publicationBlocked: false, priceCents: 1000, normalPriceCents: 1000 }], providerProducts: [] });
    const response = await put({ ...body(null), status: "PUBLISHED" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe("Configure ao menos uma variante ativa, liberada e com preço antes de publicar.");
  });

  it("salvar como rascunho sem vínculo continua permitido", async () => {
    db.product.findUnique.mockResolvedValue({ ...stored(null), variants: [], providerProducts: [] });
    expect((await put(body(null))).status).toBe(200);
  });
});
