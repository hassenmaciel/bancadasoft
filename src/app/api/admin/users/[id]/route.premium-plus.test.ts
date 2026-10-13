import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, db, tx, audit } = vi.hoisted(() => {
  const tx = {
    user: { update: vi.fn(), findUnique: vi.fn() },
    accountBalance: { upsert: vi.fn() },
  };
  return {
    requireAdmin: vi.fn(),
    audit: vi.fn(),
    tx,
    db: {
      user: { findUnique: vi.fn(), count: vi.fn() },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit, safeChangeMetadata: vi.fn() }));
import { PUT } from "./route";

const ctx = { params: Promise.resolve({ id: "u1" }) };
const put = (body: unknown) =>
  PUT(new Request("https://test", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
const current = (customerTier: string) => ({ id: "u1", name: "Cliente", role: "CUSTOMER", customerTier, canUseBalanceAsPayment: false, active: true });

describe("PUT /api/admin/users/[id] — promoção para PREMIUM_PLUS habilita o saldo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.user.count.mockResolvedValue(2);
    tx.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "u1", ...data }));
    tx.user.findUnique.mockResolvedValue({ id: "u1" });
    tx.accountBalance.upsert.mockResolvedValue({ enabled: true, balanceCents: 0 });
  });

  it("NORMAL → PREMIUM_PLUS: habilita o saldo na mesma transação e registra auditoria", async () => {
    db.user.findUnique.mockResolvedValue(current("NORMAL"));
    const response = await put({ customerTier: "PREMIUM_PLUS" });
    expect(await response.json()).toMatchObject({ balanceEnabled: true });
    expect(tx.accountBalance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1" }, update: { enabled: true }, create: { userId: "u1", enabled: true },
    }));
    expect(audit).toHaveBeenCalledWith("admin-1", "USER_BALANCE_TOGGLED", "User", "u1", { enabled: true, reason: "PREMIUM_PLUS" });
  });

  it.each([
    ["mudança para PREMIUM", "NORMAL", { customerTier: "PREMIUM" }],
    ["já era PREMIUM_PLUS", "PREMIUM_PLUS", { customerTier: "PREMIUM_PLUS" }],
    ["outra edição sem tier", "PREMIUM_PLUS", { name: "Outro nome" }],
  ])("não mexe no saldo: %s", async (_label, tier, body) => {
    db.user.findUnique.mockResolvedValue(current(tier));
    const response = await put(body);
    expect(await response.json()).toMatchObject({ balanceEnabled: false });
    expect(tx.accountBalance.upsert).not.toHaveBeenCalled();
  });
});
