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
const current = (customerTier: string, extra: Record<string, unknown> = {}) => ({
  id: "u1", name: "Cliente", role: "CUSTOMER", customerTier, canUseBalanceAsPayment: false, balanceTopupBlocked: false, active: true, ...extra,
});

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
    // Mesma regra da promoção por recarga: uso de saldo gravado na mesma transação.
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { customerTier: "PREMIUM_PLUS", canUseBalanceAsPayment: true },
    }));
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

describe("PUT /api/admin/users/[id] — rebaixamento e bloqueio de recarga (R6/R7/R8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    db.user.count.mockResolvedValue(2);
    tx.user.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "u1", balanceTopupBlocked: false, ...data }));
  });

  it.each(["NORMAL", "PREMIUM"])("PREMIUM_PLUS → %s sem bloqueio: só o tier muda (saldo e uso de saldo preservados)", async (tier) => {
    db.user.findUnique.mockResolvedValue(current("PREMIUM_PLUS", { canUseBalanceAsPayment: true }));
    const response = await put({ customerTier: tier });
    expect(await response.json()).toMatchObject({ demotedFromPremiumPlus: true, balanceEnabled: false });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { customerTier: tier } }));
    expect(tx.accountBalance.upsert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalledWith("admin-1", "USER_TOPUP_BLOCK_TOGGLED", "User", "u1", expect.anything());
  });

  it("PREMIUM_PLUS → NORMAL com bloqueio na mesma ação: uma única atualização e auditoria com o motivo", async () => {
    db.user.findUnique.mockResolvedValue(current("PREMIUM_PLUS", { canUseBalanceAsPayment: true }));
    await put({ customerTier: "NORMAL", balanceTopupBlocked: true });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { customerTier: "NORMAL", balanceTopupBlocked: true } }));
    expect(audit).toHaveBeenCalledWith("admin-1", "USER_TOPUP_BLOCK_TOGGLED", "User", "u1", { blocked: true, reason: "DEMOTED_FROM_PREMIUM_PLUS" });
  });

  it("o interruptor liga e desliga o bloqueio com auditoria; sem mudança, sem auditoria do bloqueio", async () => {
    db.user.findUnique.mockResolvedValue(current("NORMAL"));
    await put({ balanceTopupBlocked: true });
    expect(audit).toHaveBeenCalledWith("admin-1", "USER_TOPUP_BLOCK_TOGGLED", "User", "u1", { blocked: true });
    audit.mockClear();
    db.user.findUnique.mockResolvedValue(current("NORMAL", { balanceTopupBlocked: true }));
    await put({ balanceTopupBlocked: false });
    expect(audit).toHaveBeenCalledWith("admin-1", "USER_TOPUP_BLOCK_TOGGLED", "User", "u1", { blocked: false });
    audit.mockClear();
    await put({ balanceTopupBlocked: true });
    expect(audit).not.toHaveBeenCalledWith("admin-1", "USER_TOPUP_BLOCK_TOGGLED", "User", "u1", expect.anything());
  });

  it("recusa balanceTopupBlocked que não seja booleano", async () => {
    db.user.findUnique.mockResolvedValue(current("NORMAL"));
    expect((await put({ balanceTopupBlocked: "sim" })).status).toBe(422);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
