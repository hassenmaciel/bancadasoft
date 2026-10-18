import { describe, expect, it } from "vitest";
import { buildAdminUserWhere, parseAdminUserSearch } from "./admin-user-search";

describe("filtro administrativo de usuários", () => {
  it("sem filtros retorna where vazio", () => {
    expect(buildAdminUserWhere({})).toEqual({});
    expect(buildAdminUserWhere({ q: "  ", tier: "", balance: "", orders: "", status: "" })).toEqual({});
  });

  it("busca por nome ou e-mail sem diferenciar maiúsculas", () => {
    expect(buildAdminUserWhere({ q: " Ana " })).toEqual({
      AND: [{ OR: [{ name: { contains: "Ana", mode: "insensitive" } }, { email: { contains: "Ana", mode: "insensitive" } }] }],
    });
  });

  it("tier aceita só os valores do enum CustomerTier", () => {
    for (const tier of ["NORMAL", "PREMIUM", "PREMIUM_PLUS"])
      expect(buildAdminUserWhere({ tier })).toEqual({ AND: [{ customerTier: tier }] });
    expect(buildAdminUserWhere({ tier: "ADMIN" })).toEqual({});
    expect(buildAdminUserWhere({ tier: "premium" })).toEqual({});
  });

  it("saldo maior que zero, sem pedidos e status", () => {
    expect(buildAdminUserWhere({ balance: "positive" })).toEqual({ AND: [{ accountBalance: { is: { balanceCents: { gt: 0 } } } }] });
    expect(buildAdminUserWhere({ orders: "none" })).toEqual({ AND: [{ orders: { none: {} } }] });
    expect(buildAdminUserWhere({ status: "active" })).toEqual({ AND: [{ active: true }] });
    expect(buildAdminUserWhere({ status: "inactive" })).toEqual({ AND: [{ active: false }] });
    expect(buildAdminUserWhere({ status: "x", balance: "x", orders: "x" })).toEqual({});
  });

  it("combina todos os filtros com AND", () => {
    const where = buildAdminUserWhere({ q: "ana", tier: "PREMIUM_PLUS", balance: "positive", orders: "none", status: "active" }) as { AND: unknown[] };
    expect(where.AND).toHaveLength(5);
    expect(where.AND).toContainEqual({ customerTier: "PREMIUM_PLUS" });
    expect(where.AND).toContainEqual({ active: true });
  });

  it("lê searchParams e ignora parâmetros repetidos", () => {
    expect(parseAdminUserSearch({ q: "ana", tier: ["PREMIUM", "NORMAL"], status: "inactive" })).toEqual({
      q: "ana", tier: undefined, balance: undefined, orders: undefined, status: "inactive",
    });
  });
});
