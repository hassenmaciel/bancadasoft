import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, updateMany, auditCreate, transaction } = vi.hoisted(() => {
  const updateMany = vi.fn();
  const auditCreate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ product: { updateMany }, auditLog: { create: auditCreate } }));
  return { requireAdmin: vi.fn(), updateMany, auditCreate, transaction };
});
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/lib/admin-product-bulk", () => ({
  bulkProductSchema: { safeParse: (value: { ids?: string[]; action?: string }) => value.ids?.length && value.action ? { success: true, data: value } : { success: false } },
  bulkStatus: (action: string) => ({ PUBLISH: "PUBLISHED", DRAFT: "DRAFT", PAUSE: "PAUSED", ARCHIVE: "ARCHIVED" })[action],
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
});
