import { describe, expect, it } from "vitest";
import {
  digitsOnly,
  isValidCpf,
  isValidWhatsapp,
  normalizeWhatsapp,
} from "./checkout-validation";
describe("validação do checkout visitante", () => {
  it("normaliza e valida CPF pelos dígitos verificadores", () => {
    expect(digitsOnly("529.982.247-25")).toBe("52998224725");
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
  });
  it("rejeita CPF vazio e sequências repetitivas", () => {
    expect(isValidCpf("")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
  });
  it("normaliza WhatsApp brasileiro e exige DDD e número plausível", () => {
    expect(normalizeWhatsapp("(11) 99999-9999")).toBe("5511999999999");
    expect(isValidWhatsapp("(11) 99999-9999")).toBe(true);
    expect(isValidWhatsapp("11111111111")).toBe(false);
  });
});
