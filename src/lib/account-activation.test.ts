import { describe, expect, it } from "vitest";
import {
  AccountActivationConflictError,
  isPendingInviteAccount,
  resolveAccountActivation,
} from "./account-activation";

describe("ativação de conta guest/PENDING_INVITE (PARTE 2/3/5/6)", () => {
  it("e-mail livre segue o cadastro normal", () => {
    expect(resolveAccountActivation(null, { cpfCnpj: "52998224725" })).toEqual({
      action: "CREATE",
    });
  });

  it("conta real (com senha própria) é protegida — nunca ativa por cima", () => {
    const real = { id: "user-1", passwordHash: "$2b$12$realhash", cpfCnpj: "52998224725" };
    expect(isPendingInviteAccount(real)).toBe(false);
    expect(resolveAccountActivation(real, { cpfCnpj: "52998224725" })).toEqual({
      action: "BLOCKED",
    });
  });

  it("conta real é protegida mesmo se o CPF enviado coincidir", () => {
    const real = { id: "user-1", passwordHash: "$2b$12$realhash", cpfCnpj: "52998224725" };
    expect(resolveAccountActivation(real, { cpfCnpj: "52998224725" }).action).toBe("BLOCKED");
  });

  it("PENDING_INVITE com CPF correspondente ativa o MESMO User.id", () => {
    const guest = { id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "52998224725" };
    expect(resolveAccountActivation(guest, { cpfCnpj: "52998224725" })).toEqual({
      action: "ACTIVATE",
      userId: "user-guest-1",
    });
  });

  it("PENDING_INVITE com CPF divergente não ativa e não revela o CPF armazenado", () => {
    const guest = { id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "52998224725" };
    try {
      resolveAccountActivation(guest, { cpfCnpj: "11144477735" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountActivationConflictError);
      expect((error as Error).message).not.toContain("52998224725");
    }
  });

  it("PENDING_INVITE sem CPF armazenado nunca ativa por e-mail sozinho", () => {
    const legacyGuest = { id: "user-guest-legacy", passwordHash: "PENDING_INVITE", cpfCnpj: null };
    expect(() =>
      resolveAccountActivation(legacyGuest, { cpfCnpj: "52998224725" }),
    ).toThrow(AccountActivationConflictError);
  });
});
