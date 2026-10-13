import { describe, expect, it, vi } from "vitest";
import { purgeDecision, purgeUser, type PurgeTarget } from "./admin-user-purge";

const target = (overrides: Partial<PurgeTarget> = {}): PurgeTarget => ({
  id: "u1",
  email: "Cliente@Exemplo.com",
  role: "USER",
  active: true,
  authoredAuditLogs: 0,
  pendingPayments: 0,
  ordersInProgress: 0,
  ...overrides,
});
const input = { confirmEmail: "cliente@exemplo.com", actorId: "admin-1", activeAdminCount: 2 };

describe("purgeDecision", () => {
  it("libera quando o e-mail confere (sem diferenciar maiúsculas) e nada bloqueia", () => {
    expect(purgeDecision(target(), input)).toBeNull();
    expect(purgeDecision(target(), { ...input, confirmEmail: "  CLIENTE@exemplo.com " })).toBeNull();
  });

  it.each<[string, Partial<PurgeTarget>, Partial<typeof input>, string]>([
    ["e-mail digitado diferente", {}, { confirmEmail: "outro@exemplo.com" }, "CONFIRMATION_MISMATCH"],
    ["própria conta", { id: "admin-1" }, {}, "SELF"],
    ["único admin ativo", { role: "ADMIN" }, { activeAdminCount: 1 }, "LAST_ADMIN"],
    ["autor de ações na auditoria", { authoredAuditLogs: 3 }, {}, "HAS_ADMIN_HISTORY"],
    ["PIX pendente", { pendingPayments: 1 }, {}, "PAYMENT_PENDING"],
    ["pedido pago em processamento", { ordersInProgress: 1 }, {}, "ORDER_IN_PROGRESS"],
  ])("bloqueia: %s", (_label, t, i, expected) => {
    expect(purgeDecision(target(t), { ...input, ...i })).toBe(expected);
  });

  it("admin inativo não conta como 'último admin ativo'", () => {
    expect(purgeDecision(target({ role: "ADMIN", active: false }), { ...input, activeAdminCount: 1 })).toBeNull();
  });
});

describe("purgeUser", () => {
  it("apaga pedidos antes do usuário e todos os vínculos sem cascade", async () => {
    const calls: string[] = [];
    const deleteMany = (name: string, count = 0) => vi.fn(async () => (calls.push(name), { count }));
    const tx = {
      order: { deleteMany: deleteMany("order", 2) },
      accountLedgerEntry: { deleteMany: deleteMany("ledger", 5) },
      accountBalance: { deleteMany: deleteMany("balance") },
      resellerApiKey: { deleteMany: deleteMany("keys", 1) },
      passwordResetToken: { deleteMany: deleteMany("resetTokens") },
      user: { delete: vi.fn(async () => calls.push("user")) },
    };
    expect(await purgeUser(tx as never, "u1")).toEqual({ orders: 2, ledgerEntries: 5, resellerApiKeys: 1 });
    expect(calls).toEqual(["order", "ledger", "balance", "keys", "resetTokens", "user"]);
    expect(tx.order.deleteMany).toHaveBeenCalledWith({ where: { customerId: "u1" } });
  });
});
