import { describe, expect, it } from "vitest";
import {
  canSubmitCheckout,
  isUnlockToolLicense,
  LICENSE_ACCOUNT_CONFIRMATION,
  licenseAccountUsername,
  licenseActivationMessage,
  licenseProviderReturn,
  providerFieldPresentation,
  summaryBadge,
} from "./unlocktool-license";

const license = { brand: { name: "UnlockTool" }, type: "LICENSE" };

describe("isUnlockToolLicense", () => {
  it("é true só para marca UnlockTool + tipo LICENSE", () => {
    expect(isUnlockToolLicense(license)).toBe(true);
  });
  it.each([
    ["unlocktool-6h (aluguel)", { brand: { name: "UnlockTool" }, type: "RENTAL" }],
    ["ativação UnlockTool (pausado)", { brand: { name: "UnlockTool" }, type: "ACTIVATION" }],
    ["SamsungTool KG Bypass (LICENSE de outra marca)", { brand: { name: "SamsungTool" }, type: "LICENSE" }],
    ["Phoenix ServiceTool", { brand: { name: "Phoenix ServiceTool" }, type: "TOOL" }],
    ["AdClean", { brand: { name: "AdClean" }, type: "TOOL" }],
    ["sem marca", { brand: null, type: "LICENSE" }],
    ["marca ausente", { type: "LICENSE" }],
    ["caixa diferente", { brand: { name: "unlocktool" }, type: "LICENSE" }],
  ])("é false para %s", (_label, product) => {
    expect(isUnlockToolLicense(product)).toBe(false);
  });
  it("é false para null/undefined", () => {
    expect(isUnlockToolLicense(null)).toBe(false);
    expect(isUnlockToolLicense(undefined)).toBe(false);
  });
});

describe("providerFieldPresentation", () => {
  const email = { key: "email", label: "Email", placeholder: "Informe Email" };
  const username = { key: "username", label: "Username", placeholder: "Informe Username" };
  it("mapeia rótulo, placeholder, ajuda e autoComplete só para a licença", () => {
    const e = providerFieldPresentation(true, email);
    expect(e.label).toBe("E-mail da conta UnlockTool");
    expect(e.help).toBe(
      "É o login da sua conta UnlockTool, onde a licença será ativada. Não é o e-mail de contato.",
    );
    expect(e.autoComplete).toBe("off");
    expect(e.placeholder).toBeTruthy();
    const u = providerFieldPresentation(true, username);
    expect(u.label).toBe("Usuário da conta UnlockTool");
    expect(u.help).toBe(e.help);
    expect(u.autoComplete).toBe("off");
  });
  it("não altera campos de outras keys, mesmo na licença", () => {
    const serial = { key: "serial", label: "Serial", placeholder: "Informe Serial" };
    expect(providerFieldPresentation(true, serial)).toEqual({
      label: "Serial",
      placeholder: "Informe Serial",
    });
  });
  it("mantém rótulo e placeholder originais fora da licença (ex.: SamsungTool KG)", () => {
    expect(providerFieldPresentation(false, email)).toEqual({
      label: "Email",
      placeholder: "Informe Email",
    });
    expect(providerFieldPresentation(false, username)).toEqual({
      label: "Username",
      placeholder: "Informe Username",
    });
  });
});

describe("textos com gating", () => {
  it("selo do painel: LICENÇA só na licença", () => {
    expect(summaryBadge(true, "LICENSE")).toBe("LICENÇA");
    expect(summaryBadge(false, "RENTAL")).toBe("ALUGUEL");
    expect(summaryBadge(false, "TOOL")).toBe("FERRAMENTA");
    expect(summaryBadge(false, "LICENSE")).toBe("FERRAMENTA");
  });
  it("mensagem pós-pagamento com e sem prazo", () => {
    expect(licenseActivationMessage("24 horas")).toBe(
      "Pagamento confirmado. Sua licença está sendo ativada, prazo de até 24 horas. Você receberá por e-mail e pode fechar esta página.",
    );
    expect(licenseActivationMessage(null)).toBe(
      "Pagamento confirmado. Sua licença está sendo ativada. Você receberá por e-mail e pode fechar esta página.",
    );
    expect(licenseActivationMessage("  ")).not.toContain("prazo");
    expect(licenseActivationMessage(undefined)).not.toContain("prazo");
  });
});

describe("checkbox de conferência", () => {
  it("texto exato", () => {
    expect(LICENSE_ACCOUNT_CONFIRMATION).toBe(
      "Conferi que o usuário da conta UnlockTool está correto. Após a ativação não há estorno.",
    );
  });
  it("na licença, gerar PIX só habilita depois de marcar", () => {
    expect(canSubmitCheckout({ licenseMode: true, confirmed: false, submitting: false })).toBe(false);
    expect(canSubmitCheckout({ licenseMode: true, confirmed: true, submitting: false })).toBe(true);
    expect(canSubmitCheckout({ licenseMode: true, confirmed: true, submitting: true })).toBe(false);
  });
  it("fora da licença, o comportamento é o de sempre (só submitting bloqueia)", () => {
    expect(canSubmitCheckout({ licenseMode: false, confirmed: false, submitting: false })).toBe(true);
    expect(canSubmitCheckout({ licenseMode: false, confirmed: false, submitting: true })).toBe(false);
  });
});

describe("retorno do fornecedor", () => {
  it('"Success" curto (como o parser entrega hoje)', () => {
    expect(
      licenseProviderReturn({
        deliveryFields: [{ key: "license", label: "Licença", value: "Success", sensitive: true }],
        credential: "Success",
      }),
    ).toBe("Success");
  });
  it("campo rotulado mantém o rótulo", () => {
    expect(
      licenseProviderReturn({
        deliveryFields: [{ key: "activation", label: "Activation", value: "Successful", sensitive: false }],
      }),
    ).toBe("Activation: Successful");
  });
  it("retorno vazio ou ausente vira null", () => {
    expect(licenseProviderReturn({})).toBeNull();
    expect(licenseProviderReturn({ deliveryFields: [], credential: "  " })).toBeNull();
  });
});

describe("licenseAccountUsername", () => {
  it("lê Username (providerFieldName) ou username", () => {
    expect(licenseAccountUsername({ Username: " tecnico01 ", Email: "x@y.z" })).toBe("tecnico01");
    expect(licenseAccountUsername({ username: "abc" })).toBe("abc");
  });
  it("retorna null quando ausente ou inválido", () => {
    expect(licenseAccountUsername(null)).toBeNull();
    expect(licenseAccountUsername([])).toBeNull();
    expect(licenseAccountUsername({ Username: "  " })).toBeNull();
    expect(licenseAccountUsername({ Username: 12 })).toBeNull();
  });
});
