import { describe, expect, it } from "vitest";
import { providerFieldPresentation } from "./provider-field-presentation";

const unlockToolLicense = { brand: { name: "UnlockTool" }, type: "LICENSE" };
const phoenix = { brand: { name: "Phoenix ServiceTool" }, type: "TOOL" };
const email = { key: "email", label: "Email", placeholder: "Informe Email" };
const username = { key: "username", label: "Username", placeholder: "Informe Username" };
const serial = { key: "serial", label: "Serial", placeholder: "Informe Serial" };

describe("providerFieldPresentation", () => {
  it("licença UnlockTool: rótulo, placeholder, ajuda e autoComplete da conta", () => {
    const e = providerFieldPresentation(unlockToolLicense, email);
    expect(e.label).toBe("E-mail da conta UnlockTool");
    expect(e.help).toBe("E-mail cadastrado na sua conta UnlockTool. Não é o e-mail de contato.");
    expect(e.autoComplete).toBe("off");
    expect(e.placeholder).toBeTruthy();
    const u = providerFieldPresentation(unlockToolLicense, username);
    expect(u.label).toBe("Usuário da conta UnlockTool");
    expect(u.help).toBe("Usuário (login) da sua conta UnlockTool, onde a licença será ativada.");
    expect(u.autoComplete).toBe("off");
  });

  it("Phoenix: e-mail vira o da conta Phoenix, distinto do contato", () => {
    expect(providerFieldPresentation(phoenix, email)).toEqual({
      label: "E-mail da conta Phoenix",
      placeholder: "E-mail da sua conta Phoenix",
      help: "E-mail cadastrado na sua conta Phoenix ServiceTool. Não é o e-mail de contato.",
      autoComplete: "off",
    });
  });

  it("não altera campos de outras keys, mesmo nas marcas mapeadas", () => {
    for (const product of [unlockToolLicense, phoenix]) {
      expect(providerFieldPresentation(product, serial)).toEqual({
        label: "Serial",
        placeholder: "Informe Serial",
      });
    }
    expect(providerFieldPresentation(phoenix, username)).toEqual({
      label: "Username",
      placeholder: "Informe Username",
    });
  });

  it.each([
    ["unlocktool-6h (aluguel)", { brand: { name: "UnlockTool" }, type: "RENTAL" }],
    ["SamsungTool KG (LICENSE de outra marca)", { brand: { name: "SamsungTool" }, type: "LICENSE" }],
    ["sem marca", { brand: null, type: "TOOL" }],
    ["null", null],
  ])("mantém rótulo e placeholder originais para %s", (_label, product) => {
    expect(providerFieldPresentation(product, email)).toEqual({
      label: "Email",
      placeholder: "Informe Email",
    });
    expect(providerFieldPresentation(product, username)).toEqual({
      label: "Username",
      placeholder: "Informe Username",
    });
  });
});
