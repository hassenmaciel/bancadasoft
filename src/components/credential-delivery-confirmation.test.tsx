import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customerDelivery } from "@/lib/customer-delivery";
import CredentialDelivery from "./credential-delivery";

// Baseline da tela de entrega: o componente não muda com a prova de entrega
// dos créditos; a frase nova chega só pelas instructions gravadas.
const SECTION = '<section class="delivery credential-delivery" aria-label="Entrega digital">';
const echo = (label: string, value: string) =>
  `<dl class="customer-field-echo" aria-label="Dados informados no pedido"><dt>Dados informados no pedido</dt><dd><span>${label}</span> <strong>${value}</strong></dd></dl>`;

describe("customerDelivery: marcador confirmation não chega ao DTO", () => {
  it("entrega de confirmação com marcador: mesmo DTO de antes", () => {
    expect(
      customerDelivery({
        kind: "provider-delivery",
        deliveryType: "TEXT",
        title: "Phoenix Service Tool",
        instructions: "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.",
        confirmation: true,
      }),
    ).toEqual({
      deliveryType: "TEXT",
      title: "Phoenix Service Tool",
      instructions: "O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.",
    });
  });
});

describe("CredentialDelivery: baseline com renderToStaticMarkup", () => {
  it("crédito confirmado (texto genérico) com eco", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery
        deliveryType="TEXT"
        title="Phoenix Service Tool"
        instructions="O fornecedor confirmou a adição de 5 créditos na conta informada no pedido."
        customerFields={[{ key: "email", label: "Email", value: "teste@teste.com" }]}
      />,
    );
    expect(html).toEqual(
      `${SECTION}<b>Resultado disponível</b><p>Phoenix Service Tool</p>${echo("Email", "teste@teste.com")}<small>O fornecedor confirmou a adição de 5 créditos na conta informada no pedido.</small></section>`,
    );
  });
  it("crédito confirmado (frase nova): mesma estrutura, React escapa a conta", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery
        deliveryType="TEXT"
        title="Moto M Tool — Créditos"
        instructions="O fornecedor confirmou o pedido de 5 créditos para a conta <script>x</script>@t.com."
        customerFields={[{ key: "email", label: "EMAIL", value: "<script>x</script>@t.com" }]}
      />,
    );
    expect(html).toEqual(
      `${SECTION}<b>Resultado disponível</b><p>Moto M Tool — Créditos</p>${echo("EMAIL", "&lt;script&gt;x&lt;/script&gt;@t.com")}<small>O fornecedor confirmou o pedido de 5 créditos para a conta &lt;script&gt;x&lt;/script&gt;@t.com.</small></section>`,
    );
  });
  it("aluguel com credenciais", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery deliveryType="CREDENTIALS" title="UnlockTool 6 horas" username="u1" password="p1" instructions="Use os dados entregues somente nas condições do produto contratado." />,
    );
    expect(html).toEqual(
      `${SECTION}<b>Acesso liberado</b><p>UnlockTool 6 horas</p><div><span>Usuário/Login</span><strong>u1</strong><button type="button">Copiar</button></div><div><span>Senha</span><strong>p1</strong><button type="button">Copiar</button></div><small>Use os dados entregues somente nas condições do produto contratado.</small></section>`,
    );
  });
  it("licença UnlockTool ativada", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery
        deliveryType="LICENSE"
        title="UnlockTool — Licença 3 meses"
        instructions="A licença foi ativada na conta UnlockTool informada no pedido."
        licenseActivation
        customerFields={[{ key: "username", label: "Username", value: "tecnico01" }]}
      />,
    );
    expect(html).toEqual(
      `${SECTION}<b>Licença ativada</b><p>UnlockTool — Licença 3 meses</p><p>A licença foi ativada na conta UnlockTool informada no pedido.</p>${echo("Username", "tecnico01")}</section>`,
    );
  });
});
