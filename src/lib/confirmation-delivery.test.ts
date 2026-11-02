import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_SUCCESS_MANUAL_REVIEW_NOTE,
  confirmationAccount,
  confirmationDelivery,
  confirmationInstructions,
} from "./confirmation-delivery";

// fieldSchema no formato gravado pela sync (ex.: Phoenix 1808 / Moto M 4334).
const quantityField = { key: "quantity", type: "quantity", label: "Quantity", position: 0, required: true, sensitive: false, customerVisible: false, providerFieldName: "Quantity" };
const emailField = { key: "email", type: "email", label: "Email", position: 1, required: true, sensitive: false, customerVisible: true, providerFieldName: "Email" };
const schema = [quantityField, emailField];
const phoenix = { name: "Phoenix Service Tool" };
const item = (providerFields: unknown, fieldSchema: unknown = schema) => ({
  providerFields,
  providerProduct: { fieldSchema },
});

describe("baseline: textos atuais (devem ficar idênticos)", () => {
  it("frases genéricas, caractere por caractere", () => {
    expect(confirmationInstructions(5)).toBe("O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.");
    expect(confirmationInstructions(1)).toBe("O fornecedor confirmou o pedido na conta informada.");
    expect(confirmationInstructions(null)).toBe("O fornecedor confirmou o pedido na conta informada.");
    expect(confirmationInstructions(undefined)).toBe("O fornecedor confirmou o pedido na conta informada.");
  });
  it("nota interna de revisão manual", () => {
    expect(CONFIRMATION_SUCCESS_MANUAL_REVIEW_NOTE).toBe(
      "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir os créditos no painel do fornecedor.",
    );
  });
  it.each([
    [5, "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido."],
    [1, "O fornecedor confirmou o pedido na conta informada."],
  ])("sem dados do item (quantidade %s): mesma entrega de antes, fora o marcador", (quantity, instructions) => {
    const { confirmation: _marker, ...delivery } = confirmationDelivery(phoenix, quantity) as Record<string, unknown>;
    expect(delivery).toEqual({ kind: "provider-delivery", deliveryType: "TEXT", title: "Phoenix Service Tool", instructions });
  });
});

describe("confirmationAccount", () => {
  it("1 campo ecoado: usa esse", () => {
    expect(confirmationAccount(item({ Email: "teste@teste.com", Quantity: 5 }))).toBe("teste@teste.com");
  });
  it("1 campo ecoado fora das chaves de conta: usa esse mesmo", () => {
    const field = { ...emailField, key: "hwid", type: "text", label: "HWID", providerFieldName: "HWID" };
    expect(confirmationAccount(item({ HWID: "ABC-123", Quantity: 5 }, [quantityField, field]))).toBe("ABC-123");
  });
  it("0 campos ecoados: null", () => {
    expect(confirmationAccount(item({ Quantity: 5 }))).toBeNull();
    expect(confirmationAccount(item(null))).toBeNull();
    expect(confirmationAccount(null)).toBeNull();
  });
  it("vários campos: filtra pelas chaves email|username|login|account", () => {
    const hwid = { ...emailField, key: "hwid", type: "text", label: "HWID", position: 2, providerFieldName: "HWID" };
    expect(confirmationAccount(item({ Email: "teste@teste.com", HWID: "ABC", Quantity: 5 }, [quantityField, emailField, hwid]))).toBe("teste@teste.com");
  });
  it("vários campos com mais de uma chave de conta: null", () => {
    const username = { ...emailField, key: "username", type: "username", label: "Username", position: 2, providerFieldName: "Username" };
    expect(confirmationAccount(item({ Email: "teste@teste.com", Username: "tecnico", Quantity: 5 }, [quantityField, emailField, username]))).toBeNull();
  });
  it("vários campos sem chave de conta: null", () => {
    const a = { ...emailField, key: "imei", type: "imei", label: "IMEI", providerFieldName: "IMEI" };
    const b = { ...emailField, key: "serial", type: "serial", label: "Serial", position: 2, providerFieldName: "Serial" };
    expect(confirmationAccount(item({ IMEI: "1", Serial: "2" }, [a, b]))).toBeNull();
  });
  it("campo sensível não entra (nem como conta)", () => {
    expect(confirmationAccount(item({ Email: "teste@teste.com", Quantity: 5 }, [quantityField, { ...emailField, sensitive: true }]))).toBeNull();
  });
  it("pedido antigo sem providerProduct: usa o fieldSchema da variante", () => {
    expect(
      confirmationAccount({ providerFields: { Email: "v@teste.com" }, productVariant: { providerProduct: { fieldSchema: schema } } }),
    ).toBe("v@teste.com");
  });
});

describe("confirmationDelivery com a prova (quantidade + conta)", () => {
  it("quantidade > 1 igual à enviada: frase nova com N e conta, e marcador", () => {
    expect(confirmationDelivery(phoenix, 5, item({ Email: "teste@teste.com", Quantity: 5 }))).toEqual({
      kind: "provider-delivery",
      deliveryType: "TEXT",
      title: "Phoenix Service Tool",
      instructions: "O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.",
      confirmation: true,
    });
  });
  it("quantidade 1 igual à enviada: frase nova sem N", () => {
    expect(confirmationDelivery(phoenix, 1, item({ Email: "teste@teste.com", Quantity: 1 })).instructions).toBe(
      "O fornecedor confirmou o pedido para a conta teste@teste.com.",
    );
  });
  it("quantidade enviada como texto numérico também confere", () => {
    expect(confirmationDelivery(phoenix, 5, item({ Email: "teste@teste.com", Quantity: "5" })).instructions).toBe(
      "O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.",
    );
  });
  it.each([
    ["divergente", { Email: "teste@teste.com", Quantity: 4 }, schema],
    ["ausente em providerFields", { Email: "teste@teste.com" }, schema],
    ["sem campo quantity no fieldSchema", { Email: "teste@teste.com", Quantity: 5 }, [emailField]],
    ["não numérica", { Email: "teste@teste.com", Quantity: "cinco" }, schema],
  ])("quantidade %s: volta ao texto genérico, idêntico ao atual", (_label, providerFields, fieldSchema) => {
    expect(confirmationDelivery(phoenix, 5, item(providerFields, fieldSchema))).toEqual({
      kind: "provider-delivery",
      deliveryType: "TEXT",
      title: "Phoenix Service Tool",
      instructions: "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.",
      confirmation: true,
    });
  });
  it("sem conta (0 campos): texto genérico idêntico ao atual", () => {
    expect(confirmationDelivery(phoenix, 5, item({ Quantity: 5 })).instructions).toBe(
      "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.",
    );
    expect(confirmationDelivery(phoenix, 1, item({ Quantity: 1 })).instructions).toBe(
      "O fornecedor confirmou o pedido na conta informada.",
    );
  });
  it("campo sensível: texto genérico", () => {
    expect(
      confirmationDelivery(phoenix, 5, item({ Email: "teste@teste.com", Quantity: 5 }, [quantityField, { ...emailField, sensitive: true }])).instructions,
    ).toBe("O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.");
  });
  it("quantidade do pedido ausente: texto genérico", () => {
    expect(confirmationDelivery(phoenix, null, item({ Email: "teste@teste.com", Quantity: 1 })).instructions).toBe(
      "O fornecedor confirmou o pedido na conta informada.",
    );
  });
  it("a conta entra como digitada (sem máscara; o escape é do e-mail/React)", () => {
    expect(confirmationDelivery(phoenix, 5, item({ Email: "<script>x</script>@t.com", Quantity: 5 })).instructions).toBe(
      "O fornecedor confirmou o pedido de 5 créditos para a conta <script>x</script>@t.com.",
    );
  });
});
