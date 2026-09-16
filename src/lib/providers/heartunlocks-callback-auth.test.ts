import { describe, expect, it } from "vitest";
import { validateHeartUnlocksCallbackSecret } from "./heartunlocks-callback-auth";

describe("validateHeartUnlocksCallbackSecret", () => {
  it("autoriza quando o segredo recebido é exatamente igual ao esperado", () => {
    expect(validateHeartUnlocksCallbackSecret("internal-test-secret", "internal-test-secret")).toBe(true);
  });
  it("rejeita segredo incorreto de mesmo comprimento", () => {
    expect(validateHeartUnlocksCallbackSecret("internal-test-secreX", "internal-test-secret")).toBe(false);
  });
  it("rejeita segredo de comprimento diferente sem lançar erro", () => {
    expect(validateHeartUnlocksCallbackSecret("curto", "internal-test-secret")).toBe(false);
    expect(validateHeartUnlocksCallbackSecret("internal-test-secret-mais-longo-ainda", "internal-test-secret")).toBe(false);
  });
  it("nega (fail closed) quando não há header recebido", () => {
    expect(validateHeartUnlocksCallbackSecret(null, "internal-test-secret")).toBe(false);
  });
  it("nega (fail closed) quando a variável de ambiente esperada está ausente", () => {
    expect(validateHeartUnlocksCallbackSecret("qualquer-valor", undefined)).toBe(false);
    expect(validateHeartUnlocksCallbackSecret("qualquer-valor", "")).toBe(false);
  });
});
