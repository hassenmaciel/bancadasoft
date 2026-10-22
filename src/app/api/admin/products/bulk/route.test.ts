import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, updateMany, findMany, auditCreate, transaction } = vi.hoisted(() => {
  const updateMany = vi.fn();
  const findMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ product: { updateMany, findMany }, auditLog: { create: auditCreate } }));
  return { requireAdmin: vi.fn(), updateMany, findMany, auditCreate, transaction };
});
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/lib/admin-catalog", () => ({ adminProductDto: vi.fn() }));
vi.mock("@/lib/pricing-service", () => ({ calculateProductPricing: vi.fn(), loadPricingContext: vi.fn(), recalculateProducts: vi.fn() }));
vi.mock("@/lib/admin-product-bulk", () => ({
  bulkProductSchema: { safeParse: (value: { ids?: string[]; action?: string }) => value.ids?.length && value.action ? { success: true, data: value } : { success: false } },
  bulkStatus: (action: string) => ({ PUBLISH: "PUBLISHED", DRAFT: "DRAFT", PAUSE: "PAUSED", ARCHIVE: "ARCHIVED" })[action],
  isPricingBulkAction: () => false,
  pricingModeForBulkAction: () => null,
}));
import { PATCH } from "./route";

describe("admin product bulk route", () => {
  beforeEach(() => { requireAdmin.mockReset(); updateMany.mockReset(); auditCreate.mockReset(); transaction.mockClear(); });
  it("blocks a USER before any catalog mutation", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await PATCH(new Request("https://test/api/admin/products/bulk", { method: "PATCH", body: JSON.stringify({ ids: ["p1"], action: "PUBLISH" }) }));
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("updates only the selected products and audits an ADMIN action", async () => {
    requireAdmin.mockResolvedValue({ id: "admin-1" });
    updateMany.mockResolvedValue({ count: 2 });
    auditCreate.mockResolvedValue({ id: "audit-1" });
    const response = await PATCH(new Request("https://test/api/admin/products/bulk", { method: "PATCH", body: JSON.stringify({ ids: ["p1", "p2"], action: "PAUSE" }) }));
    expect(response.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["p1", "p2"] } }, data: { status: "PAUSED" } });
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  describe("PUBLISH: bloqueio sem produto do fornecedor", () => {
    const link = { active: true, mode: "REAL", technicalEligibility: "READY", provider: { id: "hu", code: "heartunlocks", active: true } };
    const publish = () => PATCH(new Request("https://test/api/admin/products/bulk", { method: "PATCH", body: JSON.stringify({ ids: ["p1", "p2"], action: "PUBLISH" }) }));
    beforeEach(() => { findMany.mockReset(); requireAdmin.mockResolvedValue({ id: "admin-1" }); updateMany.mockResolvedValue({ count: 2 }); });

    it("não publica nenhum se um AUTOMATIC não tiver vínculo e diz qual", async () => {
      findMany.mockResolvedValue([
        { name: "TSM", deliveryType: "AUTOMATIC", variants: [], providerProducts: [link] },
        { name: "Borneo 3 meses", deliveryType: "AUTOMATIC", variants: [], providerProducts: [] },
      ]);
      const response = await publish();
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("Nenhum produto foi publicado. Falta o produto do fornecedor em: Borneo 3 meses.");
      expect(updateMany).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    });

    it("produto com variantes mantém a regra atual na mensagem", async () => {
      findMany.mockResolvedValue([{ name: "Griffin", deliveryType: "AUTOMATIC", variants: [{ active: false, publicationBlocked: false, priceCents: 1, normalPriceCents: 1 }], providerProducts: [] }]);
      const response = await publish();
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("Nenhum produto foi publicado. Falta uma variante ativa, liberada e com preço em: Griffin.");
    });

    it("publica quando todos têm vínculo ou variante válida", async () => {
      findMany.mockResolvedValue([
        { name: "TSM", deliveryType: "AUTOMATIC", variants: [], providerProducts: [link] },
        { name: "Manual", deliveryType: "MANUAL", variants: [], providerProducts: [] },
      ]);
      const response = await publish();
      expect(response.status).toBe(200);
      expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ["p1", "p2"] } }, data: { status: "PUBLISHED" } });
    });

    it("PAUSE não consulta vínculos", async () => {
      await PATCH(new Request("https://test/api/admin/products/bulk", { method: "PATCH", body: JSON.stringify({ ids: ["p1"], action: "PAUSE" }) }));
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
