import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, syncProviderCatalog } = vi.hoisted(() => ({ requireAdmin: vi.fn(), syncProviderCatalog: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/providers/catalog-sync", () => ({ syncProviderCatalog }));
import { POST } from "./route";

describe("provider catalog sync route", () => {
  beforeEach(() => { requireAdmin.mockReset(); syncProviderCatalog.mockReset(); });
  it("blocks unauthenticated and non-admin callers", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await POST(new Request("https://test/api/admin/providers/p/sync", { method: "POST" }), { params: Promise.resolve({ id: "p" }) });
    expect(response.status).toBe(403);
    expect(syncProviderCatalog).not.toHaveBeenCalled();
  });
  it("synchronizes server-side for an authenticated admin", async () => {
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    syncProviderCatalog.mockResolvedValue({ found: 10, created: 9, updated: 1, unlinked: 9, syncedAt: "2026-09-11T12:00:00.000Z" });
    const response = await POST(new Request("https://test/api/admin/providers/p/sync", { method: "POST" }), { params: Promise.resolve({ id: "p" }) });
    expect(response.status).toBe(200);
    expect(syncProviderCatalog).toHaveBeenCalledWith("p", "admin-1");
  });
});
