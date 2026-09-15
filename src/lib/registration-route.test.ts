import { describe, expect, it, vi } from "vitest";
import { handleRegistrationRequest, type RegistrationDeps } from "./registration-route";

const validBody = {
  name: "Cliente Técnico",
  email: "cliente@example.test",
  whatsapp: "(11) 99999-9999",
  cpfCnpj: "529.982.247-25",
  password: "Senha-Forte-123!",
  passwordConfirmation: "Senha-Forte-123!",
};

const sessionUser = (overrides: Partial<Record<string, string>> = {}) => ({
  id: "user-1",
  email: "cliente@example.test",
  name: "Cliente Técnico",
  role: "USER",
  customerTier: "NORMAL" as const,
  ...overrides,
});

function makeDeps(overrides: Partial<RegistrationDeps> = {}): RegistrationDeps {
  return {
    findExisting: vi.fn(async () => null),
    hashPassword: vi.fn(async () => "$2b$12$fakehashedpasswordvalue"),
    createUser: vi.fn(async () => sessionUser()),
    activateUser: vi.fn(async () => sessionUser()),
    setSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("cadastro público / ativação de guest (PARTE 1-10)", () => {
  it("1. e-mail novo segue o cadastro normal", async () => {
    const deps = makeDeps();
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(201);
    expect(deps.createUser).toHaveBeenCalledOnce();
    expect(deps.activateUser).not.toHaveBeenCalled();
    expect(deps.setSession).toHaveBeenCalledWith(await (deps.createUser as ReturnType<typeof vi.fn>).mock.results[0].value);
  });

  it("2. conta real existente bloqueia o novo cadastro sem tocar nela", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-real", passwordHash: "$2b$12$realhash", cpfCnpj: "52998224725" })),
    });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({});
    expect(deps.createUser).not.toHaveBeenCalled();
    expect(deps.activateUser).not.toHaveBeenCalled();
    expect(deps.setSession).not.toHaveBeenCalled();
  });

  it("3/4. PENDING_INVITE + CPF correspondente ativa o MESMO User.id", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "52998224725" })),
    });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(200);
    expect(deps.activateUser).toHaveBeenCalledWith(
      "user-guest-1",
      expect.objectContaining({ passwordHash: "$2b$12$fakehashedpasswordvalue" }),
    );
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it("5/6/7/8. ativação sempre força role=USER e customerTier=NORMAL, mesmo tentando injetar ADMIN/PREMIUM", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "52998224725" })),
    });
    await handleRegistrationRequest(
      { ...validBody, role: "ADMIN", customerTier: "PREMIUM" },
      deps,
    );
    expect(deps.activateUser).toHaveBeenCalledWith(
      "user-guest-1",
      expect.objectContaining({ role: "USER", customerTier: "NORMAL" }),
    );
  });

  it("9/10. CPF divergente não ativa e não revela o CPF armazenado", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "11144477735" })),
    });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain("11144477735");
    expect(payload.code).toBe("ACCOUNT_ACTIVATION_CONFLICT");
    expect(deps.activateUser).not.toHaveBeenCalled();
  });

  it("PENDING_INVITE legado sem CPF armazenado não ativa por e-mail sozinho", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-guest-legacy", passwordHash: "PENDING_INVITE", cpfCnpj: null })),
    });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(409);
    expect(deps.activateUser).not.toHaveBeenCalled();
  });

  it("corrida na ativação (convite já consumido) retorna erro seguro sem duplicar", async () => {
    const deps = makeDeps({
      findExisting: vi.fn(async () => ({ id: "user-guest-1", passwordHash: "PENDING_INVITE", cpfCnpj: "52998224725" })),
      activateUser: vi.fn(async () => null),
    });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(409);
    expect(deps.setSession).not.toHaveBeenCalled();
  });

  it("corrida na criação (e-mail acabou de ser cadastrado) retorna erro seguro", async () => {
    const deps = makeDeps({ createUser: vi.fn(async () => null) });
    const response = await handleRegistrationRequest(validBody, deps);
    expect(response.status).toBe(409);
    expect(deps.setSession).not.toHaveBeenCalled();
  });

  it("dados inválidos são rejeitados antes de consultar o banco", async () => {
    const deps = makeDeps();
    const response = await handleRegistrationRequest({ ...validBody, cpfCnpj: "111.111.111-11" }, deps);
    expect(response.status).toBe(422);
    expect(deps.findExisting).not.toHaveBeenCalled();
  });
});
