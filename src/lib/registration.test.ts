import { describe, expect, it } from "vitest";
import { adminUserUpdateSchema } from "./admin-inputs";
import { isSupportedPasswordHash } from "./password";
import { publicUserCreateData, registrationSchema } from "./registration";

const validRegistration = {
  name: "Cliente Técnico",
  email: "CLIENTE@EXAMPLE.TEST",
  whatsapp: "(11) 99999-9999",
  cpfCnpj: "529.982.247-25",
  password: "Senha-Forte-123!",
  passwordConfirmation: "Senha-Forte-123!",
};

describe("cadastro público", () => {
  it("normaliza os dados e não aceita escolher PREMIUM ou ADMIN", () => {
    const parsed = registrationSchema.parse({
      ...validRegistration,
      customerTier: "PREMIUM",
      role: "ADMIN",
    });
    const data = publicUserCreateData(
      parsed,
      "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345",
    );

    expect(parsed.email).toBe("cliente@example.test");
    expect(parsed.whatsapp).toBe("5511999999999");
    expect(parsed.cpfCnpj).toBe("52998224725");
    expect(parsed).not.toHaveProperty("customerTier");
    expect(parsed).not.toHaveProperty("role");
    expect(data.role).toBe("USER");
    expect(data.customerTier).toBe("NORMAL");
    expect(data).not.toHaveProperty("password");
    expect(data).not.toHaveProperty("passwordConfirmation");
  });

  it("rejeita confirmação de senha divergente", () => {
    expect(
      registrationSchema.safeParse({
        ...validRegistration,
        passwordConfirmation: "Outra-Senha-123!",
      }).success,
    ).toBe(false);
  });

  it("rejeita CPF ou WhatsApp inválidos", () => {
    expect(
      registrationSchema.safeParse({ ...validRegistration, cpfCnpj: "111.111.111-11" })
        .success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({ ...validRegistration, whatsapp: "999" }).success,
    ).toBe(false);
  });

  it.each([
    "name",
    "email",
    "whatsapp",
    "cpfCnpj",
    "password",
    "passwordConfirmation",
  ] as const)("exige o campo %s", (field) => {
    const payload: Partial<typeof validRegistration> = { ...validRegistration };
    delete payload[field];
    expect(registrationSchema.safeParse(payload).success).toBe(false);
  });

  it("contrato administrativo aceita apenas NORMAL e PREMIUM", () => {
    expect(
      adminUserUpdateSchema.safeParse({ customerTier: "PREMIUM" }).success,
    ).toBe(true);
    expect(
      adminUserUpdateSchema.safeParse({ customerTier: "NORMAL" }).success,
    ).toBe(true);
    expect(
      adminUserUpdateSchema.safeParse({ customerTier: "ADMIN" }).success,
    ).toBe(false);
  });

  it("reconhece somente o formato de hash usado pelo projeto", () => {
    expect(
      isSupportedPasswordHash(
        "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toBe(true);
    expect(isSupportedPasswordHash(validRegistration.password)).toBe(false);
  });
});
