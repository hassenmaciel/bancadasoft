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

const fenix = { brand: { name: "Fenix Tool Pro" }, type: "LICENSE" };
const motoM = { brand: { name: "Moto M Tool" }, type: "LICENSE" };
// Campos como estão no fieldSchema do banco (normalizeProviderField).
const fenixUser = { key: "username", label: "user", placeholder: "Informe user" };
const motoHwid = { key: "hwid", label: "HWID", placeholder: "Informe HWID" };
const motoEmail = { key: "email", label: "EMAIL", placeholder: "Informe EMAIL" };

describe("providerFieldPresentation: Fenix Tool Pro e Moto M Tool", () => {
  it("Fenix: usuário da ferramenta, distinto do contato", () => {
    expect(providerFieldPresentation(fenix, fenixUser)).toEqual({
      label: "Usuário do Fenix Tool Pro",
      placeholder: "Seu usuário do Fenix Tool Pro",
      help: "Você encontra o usuário dentro do próprio Fenix Tool Pro. Não é o e-mail de contato.",
      autoComplete: "off",
    });
  });

  it("Moto M ativação: HWID", () => {
    expect(providerFieldPresentation(motoM, motoHwid)).toEqual({
      label: "HWID do Moto M Tool",
      placeholder: "Cole aqui o HWID",
      help: "Você encontra o HWID dentro do próprio Moto M Tool.",
      autoComplete: "off",
    });
  });

  it("Moto M renovação: e-mail da conta, distinto do contato", () => {
    expect(providerFieldPresentation(motoM, motoEmail)).toEqual({
      label: "E-mail da conta Moto M",
      placeholder: "E-mail da sua conta Moto M Tool",
      help: "Informe o e-mail da conta Moto M que será renovada. Não é o e-mail de contato da compra.",
      autoComplete: "off",
    });
  });

  it("Fenix/email e Moto/username permanecem crus", () => {
    expect(providerFieldPresentation(fenix, email)).toEqual({ label: "Email", placeholder: "Informe Email" });
    expect(providerFieldPresentation(motoM, username)).toEqual({ label: "Username", placeholder: "Informe Username" });
  });

  it.each([
    ["UnlockTool LICENSE", unlockToolLicense],
    ["UnlockTool RENTAL", { brand: { name: "UnlockTool" }, type: "RENTAL" }],
    ["Phoenix", phoenix],
    ["Fenix", fenix],
    ["FRPFILE", { brand: { name: "FRPFILE" }, type: "IMEI_SN" }],
    ["sem marca", { brand: null, type: "LICENSE" }],
    ["null", null],
  ])("hwid só recebe texto na marca Moto M Tool (%s fica cru)", (_label, product) => {
    expect(providerFieldPresentation(product, motoHwid)).toEqual({ label: "HWID", placeholder: "Informe HWID" });
  });
});

// Regressão: resultado atual dos produtos já vendendo (fieldSchema do banco).
describe("providerFieldPresentation: regressão dos produtos atuais", () => {
  const unlockRental = { brand: { name: "UnlockTool" }, type: "RENTAL" };
  const frpfile = { brand: { name: "FRPFILE" }, type: "IMEI_SN" };
  const ecid = { key: "ecid", label: "ECID", placeholder: "Informe ECID" };
  const ecidLower = { key: "ecid", label: "ecid", placeholder: "Informe ecid" };
  const serialTrailing = { key: "serial", label: "Serial", placeholder: "Informe Serial " };
  const serialOnly = { key: "serial", label: "Serial only", placeholder: "Informe Serial only " };
  const unlockEmail = {
    label: "E-mail da conta UnlockTool",
    placeholder: "E-mail da sua conta UnlockTool",
    help: "E-mail cadastrado na sua conta UnlockTool. Não é o e-mail de contato.",
    autoComplete: "off",
  };
  const unlockUser = {
    label: "Usuário da conta UnlockTool",
    placeholder: "Usuário da sua conta UnlockTool",
    help: "Usuário (login) da sua conta UnlockTool, onde a licença será ativada.",
    autoComplete: "off",
  };
  const phoenixEmail = {
    label: "E-mail da conta Phoenix",
    placeholder: "E-mail da sua conta Phoenix",
    help: "E-mail cadastrado na sua conta Phoenix ServiceTool. Não é o e-mail de contato.",
    autoComplete: "off",
  };

  it.each([
    ["UnlockTool LICENSE / email", unlockToolLicense, email, unlockEmail],
    ["UnlockTool LICENSE / username", unlockToolLicense, username, unlockUser],
    ["UnlockTool RENTAL / email", unlockRental, email, { label: "Email", placeholder: "Informe Email" }],
    ["UnlockTool RENTAL / username", unlockRental, username, { label: "Username", placeholder: "Informe Username" }],
    ["Phoenix / email", phoenix, email, phoenixEmail],
    ["Phoenix / username", phoenix, username, { label: "Username", placeholder: "Informe Username" }],
    ["FRPFILE / ECID", frpfile, ecid, { label: "ECID", placeholder: "Informe ECID" }],
    ["FRPFILE / ecid", frpfile, ecidLower, { label: "ecid", placeholder: "Informe ecid" }],
    ["FRPFILE / \"Serial \"", frpfile, serialTrailing, { label: "Serial", placeholder: "Informe Serial " }],
    ["FRPFILE / \"Serial only \"", frpfile, serialOnly, { label: "Serial only", placeholder: "Informe Serial only " }],
    ["sem marca / email", { brand: null, type: "TOOL" }, email, { label: "Email", placeholder: "Informe Email" }],
    ["sem marca / username", { brand: null, type: "TOOL" }, username, { label: "Username", placeholder: "Informe Username" }],
    ["null / email", null, email, { label: "Email", placeholder: "Informe Email" }],
    ["null / serial", null, serial, { label: "Serial", placeholder: "Informe Serial" }],
  ])("%s", (_label, product, field, expected) => {
    expect(providerFieldPresentation(product, field)).toEqual(expected);
  });
});
