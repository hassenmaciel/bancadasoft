import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, tx } = vi.hoisted(() => {
  const tx = {
    passwordResetToken: { updateMany: vi.fn(), deleteMany: vi.fn() },
    user: { update: vi.fn() },
  };
  return {
    tx,
    db: {
      user: { findUnique: vi.fn() },
      passwordResetToken: { findUnique: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
      passwordResetRequest: { count: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn(async (arg: unknown) =>
        typeof arg === "function" ? (arg as (client: typeof tx) => Promise<unknown>)(tx) : Promise.all(arg as unknown[]),
      ),
    },
  };
});
vi.mock("./prisma", () => ({ prisma: db }));
vi.stubEnv("AUTH_SECRET", "test-secret-with-at-least-thirty-two-bytes!!");

import {
  PASSWORD_RESET_MAX_PER_EMAIL,
  PASSWORD_RESET_TTL_MS,
  completePasswordReset,
  createResetToken,
  hashResetToken,
  issuePasswordReset,
  passwordResetConfirmSchema,
  passwordResetEmailContent,
  passwordResetUrl,
  registerResetRequest,
  resetEmailHash,
} from "./password-reset";
import { isSessionCurrent } from "./session-validity";

const now = new Date("2026-10-13T12:00:00.000Z");

describe("token de redefinição", () => {
  it("guarda só o hash SHA-256 e expira em 1h", () => {
    const created = createResetToken(now);
    expect(created.token.length).toBeGreaterThanOrEqual(43);
    expect(created.tokenHash).toBe(hashResetToken(created.token));
    expect(created.tokenHash).not.toContain(created.token);
    expect(created.expiresAt.getTime() - now.getTime()).toBe(PASSWORD_RESET_TTL_MS);
  });

  it("vai no fragmento do link (não chega ao servidor nem ao Referer)", () => {
    expect(passwordResetUrl("https://www.bancadasoft.com.br/", "abc")).toBe(
      "https://www.bancadasoft.com.br/redefinir-senha#token=abc",
    );
  });

  it("o e-mail escapa o nome do cliente", () => {
    const content = passwordResetEmailContent({ name: "<script>", url: "https://x/redefinir-senha#token=a" });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;");
  });
});

describe("validade da sessão após troca de senha", () => {
  const changed = new Date("2026-10-13T12:00:00.500Z");
  it("sem troca de senha, toda sessão segue válida", () => {
    expect(isSessionCurrent(1, null)).toBe(true);
  });
  it("sessão emitida antes da troca cai; depois (ou no mesmo segundo) vale", () => {
    const changedSeconds = Math.floor(changed.getTime() / 1000);
    expect(isSessionCurrent(changedSeconds - 1, changed)).toBe(false);
    expect(isSessionCurrent(changedSeconds, changed)).toBe(true);
    expect(isSessionCurrent(changedSeconds + 60, changed)).toBe(true);
  });
  it("token sem iat não vale depois de uma troca", () => {
    expect(isSessionCurrent(undefined, changed)).toBe(false);
  });
});

describe("rate limit do pedido", () => {
  beforeEach(() => vi.clearAllMocks());

  it("bloqueia ao atingir o limite por e-mail, sem gravar novo pedido", async () => {
    db.passwordResetRequest.count.mockResolvedValueOnce(PASSWORD_RESET_MAX_PER_EMAIL).mockResolvedValueOnce(0);
    expect(await registerResetRequest("a@b.com", "1.1.1.1", now)).toEqual({ allowed: false });
    expect(db.passwordResetRequest.create).not.toHaveBeenCalled();
  });

  it("grava só HMACs, nunca o e-mail ou IP em texto puro", async () => {
    db.passwordResetRequest.count.mockResolvedValue(0);
    expect(await registerResetRequest("a@b.com", "1.1.1.1", now)).toEqual({ allowed: true });
    const data = db.passwordResetRequest.create.mock.calls[0][0].data;
    expect(data.emailHash).toBe(resetEmailHash("a@b.com"));
    expect(JSON.stringify(data)).not.toContain("a@b.com");
    expect(JSON.stringify(data)).not.toContain("1.1.1.1");
  });
});

describe("emissão do link", () => {
  beforeEach(() => vi.clearAllMocks());
  const transport = { send: vi.fn(async () => ({ messageId: "m1" })) };

  it("conta inexistente ou inativa: não cria token nem envia nada", async () => {
    db.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "u1", name: "A", email: "a@b.com", active: false });
    expect(await issuePasswordReset("x@y.com", "https://site", { transport })).toEqual({ status: "SKIPPED" });
    expect(await issuePasswordReset("a@b.com", "https://site", { transport })).toEqual({ status: "SKIPPED" });
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("conta ativa: anula links anteriores, grava o hash e envia o token só no e-mail", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", name: "Ana", email: "a@b.com", active: true });
    expect(await issuePasswordReset("a@b.com", "https://site", { transport, from: "no-reply@site" })).toEqual({ status: "SENT" });
    expect(db.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", usedAt: null } });
    const stored = db.passwordResetToken.create.mock.calls[0][0].data;
    const sent = (transport.send.mock.calls[0] as unknown as [{ text: string; to: string }])[0];
    const token = decodeURIComponent(sent.text.match(/#token=([^\s]+)/)![1]);
    expect(sent.to).toBe("a@b.com");
    expect(stored.tokenHash).toBe(hashResetToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });
});

describe("conclusão da redefinição", () => {
  beforeEach(() => vi.clearAllMocks());
  const valid = { id: "t1", userId: "u1", expiresAt: new Date(now.getTime() + 1000), usedAt: null, user: { active: true } };

  it.each([
    ["inexistente", null],
    ["expirado", { ...valid, expiresAt: new Date(now.getTime() - 1) }],
    ["já usado", { ...valid, usedAt: now }],
    ["de conta inativa", { ...valid, user: { active: false } }],
  ])("token %s é recusado sem tocar na senha", async (_label, record) => {
    db.passwordResetToken.findUnique.mockResolvedValue(record);
    expect(await completePasswordReset("tok", "Senha@Forte123", now)).toBe("INVALID_TOKEN");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("uso único: se outro envio já consumiu o token, não troca a senha", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(valid);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await completePasswordReset("tok", "Senha@Forte123", now)).toBe("INVALID_TOKEN");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("troca a senha, marca passwordChangedAt (derruba sessões) e apaga os outros tokens", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(valid);
    tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    expect(await completePasswordReset("tok", "Senha@Forte123", now)).toBe("OK");
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashResetToken("tok") } }));
    const update = tx.user.update.mock.calls[0][0];
    expect(update.data.passwordChangedAt).toEqual(now);
    expect(update.data.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(tx.passwordResetToken.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1", id: { not: "t1" } } });
  });

  it("exige a mesma política de senha forte e confirmação igual", () => {
    expect(passwordResetConfirmSchema.safeParse({ token: "x".repeat(43), password: "fraca", passwordConfirmation: "fraca" }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ token: "x".repeat(43), password: "Senha@Forte123", passwordConfirmation: "Outra@Forte123" }).success).toBe(false);
    expect(passwordResetConfirmSchema.safeParse({ token: "x".repeat(43), password: "Senha@Forte123", passwordConfirmation: "Senha@Forte123" }).success).toBe(true);
  });
});
