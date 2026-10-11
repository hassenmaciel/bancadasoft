import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import CredentialDelivery from "@/components/credential-delivery";
import { customerFieldEcho, orderFieldEcho, orderItemFieldEcho } from "./customer-field-echo";

// Schemas no mesmo formato gravado em ProviderProduct.fieldSchema (dados fictícios).
const field = (over: Record<string, unknown>) => ({
  type: "text",
  required: true,
  placeholder: "",
  validation: null,
  position: 0,
  sensitive: false,
  customerVisible: true,
  ...over,
});
const QUANTITY = field({ key: "quantity", type: "quantity", label: "Quantity", providerFieldName: "Quantity", customerVisible: false });
const ECID_SCHEMA = [field({ key: "ecid", label: "ECID", providerFieldName: "ECID" })];
const SERIAL_TRAILING_SPACE = [field({ key: "serial", type: "serial", label: "Serial", providerFieldName: "Serial " })];
const UNLOCKTOOL_SCHEMA = [
  field({ key: "email", type: "email", label: "Email", providerFieldName: "Email", position: 0 }),
  field({ key: "username", type: "username", label: "Username", providerFieldName: "Username", position: 1 }),
];
const PHOENIX_SCHEMA = [QUANTITY, field({ key: "email", type: "email", label: "Email", providerFieldName: "Email", position: 1 })];

describe("customerFieldEcho", () => {
  it("produto com ECID: mostra label e valor gravados sob providerFieldName", () => {
    expect(customerFieldEcho(ECID_SCHEMA, { ECID: "0x1A2B3C4D5E" })).toEqual([
      { key: "ecid", label: "ECID", value: "0x1A2B3C4D5E" },
    ]);
  });

  it("providerFieldName com espaço no fim (contrato 3126) ainda casa", () => {
    expect(customerFieldEcho(SERIAL_TRAILING_SPACE, { "Serial ": "F2LXK0ABCDEF" })).toEqual([
      { key: "serial", label: "Serial", value: "F2LXK0ABCDEF" },
    ]);
  });

  it("produto sem campo de cliente (tool simples): nada extra", () => {
    expect(customerFieldEcho(null, {})).toEqual([]);
    expect(customerFieldEcho([], { Quantity: 1 })).toEqual([]);
    expect(orderItemFieldEcho({ providerFields: null, providerProduct: null, productVariant: null })).toEqual([]);
  });

  it("mais de um campo visível (UnlockTool): todos, na ordem do schema", () => {
    expect(
      customerFieldEcho(UNLOCKTOOL_SCHEMA, { Username: "usuario_teste", Email: "conta@exemplo.test" }),
    ).toEqual([
      { key: "email", label: "Email", value: "conta@exemplo.test" },
      { key: "username", label: "Username", value: "usuario_teste" },
    ]);
  });

  it("Phoenix: e-mail aparece, Quantity (interno) nunca", () => {
    const echo = customerFieldEcho(PHOENIX_SCHEMA, { Quantity: 1, Email: "conta@exemplo.test" });
    expect(echo).toEqual([{ key: "email", label: "Email", value: "conta@exemplo.test" }]);
  });

  it("não vaza campo não visível, sensível ou fora do schema", () => {
    const schema = [
      ...ECID_SCHEMA,
      field({ key: "internal", label: "Interno", providerFieldName: "Internal", customerVisible: false }),
      field({ key: "password", label: "Senha", providerFieldName: "Password", sensitive: true }),
    ];
    const echo = customerFieldEcho(schema, { ECID: "0xABC", Internal: "x", Password: "segredo", Extra: "y" });
    expect(echo).toEqual([{ key: "ecid", label: "ECID", value: "0xABC" }]);
    expect(JSON.stringify(echo)).not.toMatch(/segredo|Internal|Extra/);
  });

  it("valor vazio não gera linha", () => {
    expect(customerFieldEcho(ECID_SCHEMA, { ECID: "   " })).toEqual([]);
  });

  it("pedido antigo sem providerProduct no item usa o schema da variante", () => {
    expect(
      orderFieldEcho([
        { providerFields: { ECID: "0x1" }, providerProduct: null, productVariant: { providerProduct: { fieldSchema: ECID_SCHEMA } } },
      ]),
    ).toEqual([{ key: "ecid", label: "ECID", value: "0x1" }]);
  });
});

describe("CredentialDelivery com echo dos dados do pedido", () => {
  const render = (props: Parameters<typeof CredentialDelivery>[0]) =>
    renderToStaticMarkup(createElement(CredentialDelivery, props));

  it("ECID aparece junto do Resultado disponível", () => {
    const html = render({
      deliveryType: "TEXT",
      title: "FRPFILE Ramdisk",
      deliveryFields: [{ key: "text", label: "Resultado", value: "Order successfully", sensitive: false }],
      customerFields: customerFieldEcho(ECID_SCHEMA, { ECID: "0x1A2B3C4D5E" }),
    });
    expect(html).toContain("Resultado disponível");
    expect(html).toContain("Dados informados no pedido");
    expect(html).toContain("ECID");
    expect(html).toContain("0x1A2B3C4D5E");
  });

  it("sem campos de cliente: nenhum bloco extra", () => {
    const html = render({
      deliveryType: "TEXT",
      title: "Tool",
      deliveryFields: [{ key: "text", label: "Resultado", value: "ok", sensitive: false }],
      customerFields: [],
    });
    expect(html).not.toContain("Dados informados no pedido");
  });

  it("licença UnlockTool: e-mail e usuário aparecem também na tela de licença", () => {
    const html = render({
      deliveryType: "LICENSE",
      title: "UnlockTool — Licença 3 meses",
      instructions: "ok",
      licenseActivation: true,
      customerFields: customerFieldEcho(UNLOCKTOOL_SCHEMA, { Email: "conta@exemplo.test", Username: "usuario_teste" }),
    });
    expect(html).toContain("Licença ativada");
    expect(html).toContain("conta@exemplo.test");
    expect(html).toContain("usuario_teste");
  });
});
