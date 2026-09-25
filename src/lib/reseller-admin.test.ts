import { afterEach, describe, expect, it, vi } from "vitest";
import { adminUserInputSchema, adminUserUpdateSchema, roleInputSchema } from "./admin-inputs";
import { issueResellerKey, revokeResellerKey, setAccountBalanceEnabled } from "./reseller-admin";
import { bearerKey, generateResellerApiKey, hashResellerApiKey, RESELLER_KEY_PREFIX } from "./reseller-keys";
import {
  AdcleanDisconnectedAdapter,
  AdcleanProviderAdapter,
  adcleanResellerConfigured,
  configuredAdcleanResellerAdapter,
} from "./providers/adclean";
import { createFakeLedgerDb } from "./testing/fake-ledger-db";

const users = [
  { id: "reseller", role: "RESELLER", active: true, passwordHash: "hash" },
  { id: "customer", role: "USER", active: true, passwordHash: "hash" },
  { id: "inactive", role: "RESELLER", active: false, passwordHash: "hash" },
];

describe("chaves de API de revenda", () => {
  it("gera 32 bytes aleatórios com prefixo e guarda só o SHA-256", () => {
    const random = vi.fn((size: number) => Buffer.alloc(size, 7));
    const { plaintext, tokenHash } = generateResellerApiKey(random);
    expect(random).toHaveBeenCalledWith(32);
    expect(plaintext.startsWith(RESELLER_KEY_PREFIX)).toBe(true);
    expect(Buffer.from(plaintext.slice(RESELLER_KEY_PREFIX.length), "base64url")).toHaveLength(32);
    expect(tokenHash).toBe(hashResellerApiKey(plaintext));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(generateResellerApiKey().plaintext).not.toBe(generateResellerApiKey().plaintext);
  });

  it("aceita só Authorization: Bearer bsr_...", () => {
    expect(bearerKey("Bearer bsr_abc")).toBe("bsr_abc");
    for (const header of [null, "bsr_abc", "Bearer abc", "Basic bsr_abc", `Bearer bsr_${"x".repeat(300)}`]) expect(bearerKey(header)).toBeNull();
  });

  it("emite para RESELLER ativo, devolve a chave em texto puro uma vez e persiste só o hash", async () => {
    const db = createFakeLedgerDb({ users });
    const result = await issueResellerKey(db as never, "reseller", "loja");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.state.keys).toHaveLength(1);
    expect(db.state.keys[0]).toMatchObject({ userId: "reseller", label: "loja", tokenHash: hashResellerApiKey(result.plaintext) });
    expect(JSON.stringify(db.state.keys)).not.toContain(result.plaintext);
  });

  it("recusa emitir para conta não RESELLER, inativa ou inexistente", async () => {
    const db = createFakeLedgerDb({ users });
    expect(await issueResellerKey(db as never, "customer")).toEqual({ ok: false, code: "RESELLER_REQUIRED" });
    expect(await issueResellerKey(db as never, "inactive")).toEqual({ ok: false, code: "RESELLER_REQUIRED" });
    expect(await issueResellerKey(db as never, "ghost")).toEqual({ ok: false, code: "USER_NOT_FOUND" });
    expect(db.state.keys).toHaveLength(0);
  });

  it("revoga marcando active=false e revokedAt, de forma idempotente e só dentro do próprio usuário", async () => {
    const db = createFakeLedgerDb({ users });
    const issued = await issueResellerKey(db as never, "reseller");
    if (!issued.ok) throw new Error("setup");
    expect(await revokeResellerKey(db as never, "customer", issued.key.id)).toEqual({ ok: false, code: "KEY_NOT_FOUND" });
    const when = new Date("2026-09-25T12:00:00Z");
    expect(await revokeResellerKey(db as never, "reseller", issued.key.id, when)).toEqual({ ok: true, alreadyRevoked: false });
    expect(await revokeResellerKey(db as never, "reseller", issued.key.id, new Date())).toEqual({ ok: true, alreadyRevoked: true });
    expect(db.state.keys[0]).toMatchObject({ active: false, revokedAt: when });
  });
});

describe("toggle de saldo no Admin", () => {
  it("cria a linha sob demanda com saldo 0 e depois só muda enabled", async () => {
    const db = createFakeLedgerDb({ users });
    expect(await setAccountBalanceEnabled(db as never, "customer", true)).toMatchObject({ ok: true, balance: { enabled: true, balanceCents: 0 } });
    db.state.balances[0].balanceCents = 700;
    expect(await setAccountBalanceEnabled(db as never, "customer", false)).toMatchObject({ ok: true, balance: { enabled: false, balanceCents: 700 } });
    expect(db.state.balances).toHaveLength(1);
    expect(await setAccountBalanceEnabled(db as never, "ghost", true)).toEqual({ ok: false, code: "USER_NOT_FOUND" });
  });
});

describe("papel RESELLER nos schemas do Admin", () => {
  it("aceita RESELLER na criação, na edição e na troca de papel, e continua recusando papéis desconhecidos", () => {
    const base = { name: "Revenda", email: "revenda@example.test", password: "Senha-Forte-123!" };
    expect(adminUserInputSchema.safeParse({ ...base, role: "RESELLER" }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ role: "RESELLER" }).success).toBe(true);
    expect(roleInputSchema.safeParse({ role: "RESELLER" }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ role: "SUPERUSER" }).success).toBe(false);
  });
});

describe("adapter AdClean da revenda", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("usa ADCLEAN_RESELLER_TOKEN (não o token de parceiro) e fica desconectado sem ele", () => {
    vi.stubEnv("ADCLEAN_PARTNER_TOKEN", "partner-token");
    vi.stubEnv("ADCLEAN_RESELLER_TOKEN", "");
    expect(adcleanResellerConfigured()).toBe(false);
    expect(configuredAdcleanResellerAdapter()).toBeInstanceOf(AdcleanDisconnectedAdapter);
    vi.stubEnv("ADCLEAN_RESELLER_TOKEN", "reseller-token");
    expect(adcleanResellerConfigured()).toBe(true);
    expect(configuredAdcleanResellerAdapter()).toBeInstanceOf(AdcleanProviderAdapter);
  });
});
