import { describe, expect, it } from "vitest";
import { checkoutSchema } from "./checkout-schema";
const valid = {
  productId: "product",
  name: "Cliente Teste",
  email: "cliente@example.com",
  whatsapp: "11999999999",
  cpfCnpj: "52998224725",
  deliveryAccessToken: "secure-checkout-token-with-32-characters",
};
describe("contrato do checkout guest", () => {
  it("aceita compra sem senha ou ativação de conta", () => {
    const result = checkoutSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.success && "password" in result.data).toBe(false);
  });
  it.each([
    ["name", ""] as const,
    ["cpfCnpj", ""] as const,
    ["email", ""] as const,
    ["whatsapp", ""] as const,
  ])("exige %s", (field, value) =>
    expect(checkoutSchema.safeParse({ ...valid, [field]: value }).success).toBe(
      false,
    ),
  );
  it("rejeita CPF inválido e repetitivo", () => {
    expect(
      checkoutSchema.safeParse({ ...valid, cpfCnpj: "52998224724" }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...valid, cpfCnpj: "11111111111" }).success,
    ).toBe(false);
  });
});
