import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customerDelivery } from "@/lib/customer-delivery";
import { parseProviderDelivery } from "@/lib/providers/delivery";
import CredentialDelivery from "./credential-delivery";

// Dados FICTÍCIOS. O mesmo componente renderiza a entrega no checkout, em
// "Meus pedidos" e em /acompanhar; o que chega a ele é o retorno de
// customerDelivery() sobre o JSON gravado por parseProviderDelivery().
const PRODUCT = { name: "UnlockTool — Licença 12 meses" };
const REAL_LIKE =
  "UnlockTool: 12 Months Username: usuario_teste Email: teste@exemplo.com Order date: 14/07/2026 02:51:49 Status: Activated Successfully.";

function screen(replay: string | null) {
  const stored = replay === null ? null : parseProviderDelivery(replay, PRODUCT, "LICENSE");
  const delivery = customerDelivery(stored);
  return {
    stored,
    delivery,
    html: delivery
      ? renderToStaticMarkup(<CredentialDelivery {...delivery} licenseActivation />)
      : "",
  };
}

describe("exibição da entrega de licença (parser atual, sem alterá-lo)", () => {
  it('retorno "Success": um campo, título Licença ativada, sem copiar e sem sensível', () => {
    const { stored, html } = screen("Success");
    expect(stored?.deliveryType).toBe("LICENSE");
    expect(html).toContain("Licença ativada");
    expect(html).toContain("Retorno do fornecedor: Success");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Licença liberada");
  });

  it("retorno real em uma linha só: vira 1 campo LICENSE com o texto inteiro", () => {
    const { stored, html } = screen(REAL_LIKE);
    expect(stored?.deliveryType).toBe("LICENSE");
    expect(stored?.deliveryFields).toHaveLength(1);
    expect(stored?.deliveryFields[0]).toMatchObject({ key: "unlocktool", label: "UnlockTool", sensitive: false });
    expect(stored?.credential).toBe(
      "12 Months Username: usuario_teste Email: teste@exemplo.com Order date: 14/07/2026 02:51:49 Status: Activated Successfully.",
    );
    expect(html).toContain("Licença ativada");
    expect(html).toContain(
      "Retorno do fornecedor: UnlockTool: 12 Months Username: usuario_teste Email: teste@exemplo.com Order date: 14/07/2026 02:51:49 Status: Activated Successfully.",
    );
    expect(html).not.toContain("<button");
  });

  it("retorno real com quebras (<br>): MULTI_FIELD, exibido em uma linha com separadores", () => {
    const { stored, html } = screen(REAL_LIKE.replace(/ (Username|Email|Order date|Status):/g, "<br>$1:"));
    expect(stored?.deliveryType).toBe("MULTI_FIELD");
    expect(stored?.deliveryFields.map((f) => f.key)).toEqual([
      "unlocktool",
      "username",
      "email",
      "order_date",
      "status",
    ]);
    expect(html).toContain(
      "Retorno do fornecedor: UnlockTool: 12 Months · Username: usuario_teste · Email: teste@exemplo.com · Order date: 14/07/2026 02:51:49 · Status: Activated Successfully.",
    );
    expect(html).toContain("Licença ativada");
    expect(html).not.toContain("<button");
  });

  it("retorno vazio: o parser não gera entrega; sem entrega não há tela (não renderiza nada)", () => {
    expect(parseProviderDelivery("", PRODUCT, "LICENSE")).toBeNull();
    expect(parseProviderDelivery("   ", PRODUCT, "LICENSE")).toBeNull();
    expect(screen(null).html).toBe("");
  });

  it("entrega LICENSE já gravada sem campos legíveis: tela sem linha de retorno", () => {
    const delivery = customerDelivery({ deliveryType: "LICENSE", title: PRODUCT.name, credential: "x" });
    expect(delivery).not.toBeNull();
    const html = renderToStaticMarkup(
      <CredentialDelivery deliveryType="LICENSE" title={PRODUCT.name} licenseActivation />,
    );
    expect(html).toContain("Licença ativada");
    expect(html).not.toContain("Retorno do fornecedor");
  });
});

// Entrega mínima gravada pelo callback quando o fornecedor confirma sucesso
// sem retorno textual (licença UnlockTool): sem credential e sem campos.
describe("entrega mínima de licença (sucesso sem retorno textual)", () => {
  const minimal = {
    kind: "provider-delivery",
    deliveryType: "LICENSE",
    title: PRODUCT.name,
    instructions: "A ativação foi confirmada pelo fornecedor, sem retorno textual.",
  };
  it("customerDelivery aceita (senão o checkout ficaria em 'carregando' para sempre)", () => {
    const delivery = customerDelivery(minimal);
    expect(delivery).toEqual({
      deliveryType: "LICENSE",
      title: PRODUCT.name,
      instructions: minimal.instructions,
    });
  });
  it("Checkout, Meus pedidos e /acompanhar usam o mesmo componente: 'Licença ativada' sem erro e sem retorno", () => {
    const delivery = customerDelivery(minimal)!;
    const html = renderToStaticMarkup(<CredentialDelivery {...delivery} licenseActivation />);
    expect(html).toContain("Licença ativada");
    expect(html).toContain("conta UnlockTool informada");
    expect(html).not.toContain("Retorno do fornecedor");
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/erro|falha/i);
  });
  it("sem o gate de licença, o componente também renderiza sem quebrar", () => {
    const delivery = customerDelivery(minimal)!;
    const html = renderToStaticMarkup(<CredentialDelivery {...delivery} />);
    expect(html).toContain("Licença liberada");
  });
  it("o validador continua recusando LICENSE/CODE vazios sem instruções", () => {
    expect(customerDelivery({ deliveryType: "LICENSE", title: "x" })).toBeNull();
    expect(customerDelivery({ deliveryType: "CODE", title: "x", instructions: "y" })).toBeNull();
    expect(customerDelivery({ deliveryType: "CREDENTIALS", instructions: "y" })).toBeNull();
    expect(customerDelivery({ deliveryType: "MULTI_FIELD", instructions: "y" })).toBeNull();
  });
});
