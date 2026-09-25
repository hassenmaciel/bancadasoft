import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, db, tx } = vi.hoisted(() => {
  const tx = { user: { delete: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() } };
  return {
    requireAdmin: vi.fn(),
    tx,
    db: {
      user: { findUnique: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), safeChangeMetadata: vi.fn() }));
import { DELETE } from "./route";

const ctx = { params: Promise.resolve({ id: "u1" }) };
const user = (counts: Partial<Record<"orders" | "auditLogs" | "ledgerEntries" | "resellerApiKeys", number>>, accountBalance: { id: string } | null = null) => ({
  id: "u1",
  name: "Cliente",
  role: "RESELLER",
  _count: { orders: 0, auditLogs: 0, ledgerEntries: 0, resellerApiKeys: 0, ...counts },
  accountBalance,
});

describe("DELETE /api/admin/users/[id] — saldo e revenda também são histórico", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.user.count.mockResolvedValue(2);
  });

  it("exclui quando não há nenhum histórico", async () => {
    db.user.findUnique.mockResolvedValue(user({}));
    expect(await (await DELETE(new Request("https://test"), ctx)).json()).toMatchObject({ data: { action: "DELETE" } });
    expect(tx.user.delete).toHaveBeenCalled();
  });

  it.each([
    ["linha de saldo", user({}, { id: "bal-1" })],
    ["lançamentos no ledger", user({ ledgerEntries: 1 })],
    ["chaves de API", user({ resellerApiKeys: 1 })],
  ])("desativa em vez de excluir quando há %s (FK RESTRICT)", async (_label, current) => {
    db.user.findUnique.mockResolvedValue(current);
    expect(await (await DELETE(new Request("https://test"), ctx)).json()).toMatchObject({ data: { action: "ARCHIVE" } });
    expect(tx.user.delete).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { active: false } });
  });
});
