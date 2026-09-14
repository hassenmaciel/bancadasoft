import { describe, expect, it } from "vitest";
import { adminUserUpdateSchema } from "./admin-inputs";
import { registrationSchema } from "./registration";

describe("controle do nível comercial", () => {
  it("cadastro público não aceita escolher PREMIUM ou role", () => {
    const parsed = registrationSchema.parse({ name: "Cliente", email: "CLIENTE@EXAMPLE.TEST", password: "Senha-Forte-123!", customerTier: "PREMIUM", role: "ADMIN" });
    expect(parsed.email).toBe("cliente@example.test");
    expect(parsed).not.toHaveProperty("customerTier");
    expect(parsed).not.toHaveProperty("role");
  });
  it("contrato administrativo aceita apenas NORMAL e PREMIUM", () => {
    expect(adminUserUpdateSchema.safeParse({ customerTier: "PREMIUM" }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ customerTier: "NORMAL" }).success).toBe(true);
    expect(adminUserUpdateSchema.safeParse({ customerTier: "ADMIN" }).success).toBe(false);
  });
});
