import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CredentialDelivery from "./credential-delivery";
import LicenseAccountConfirmation from "./license-account-confirmation";

describe("LicenseAccountConfirmation", () => {
  it("renderiza o checkbox obrigatório desmarcado com o texto de conferência", () => {
    const html = renderToStaticMarkup(
      <LicenseAccountConfirmation checked={false} onChange={() => undefined} />,
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("required");
    expect(html).not.toContain("checked");
    expect(html).toContain(
      "Conferi que o usuário da conta UnlockTool está correto. A licença é ativada na conta informada e a ativação não pode ser desfeita.",
    );
  });
  it("reflete o estado marcado", () => {
    const html = renderToStaticMarkup(
      <LicenseAccountConfirmation checked onChange={() => undefined} />,
    );
    expect(html).toContain('checked=""');
  });
});

describe("CredentialDelivery (tela de entrega)", () => {
  const success = {
    deliveryType: "LICENSE" as const,
    title: "UnlockTool — Licença 3 meses",
    credential: "Success",
    deliveryFields: [{ key: "license", label: "Licença", value: "Success", sensitive: true }],
    instructions: "Use os dados entregues somente nas condições do produto contratado.",
  };
  it('licença + retorno "Success": título "Licença ativada", sem copiar, retorno como texto secundário', () => {
    const html = renderToStaticMarkup(<CredentialDelivery {...success} licenseActivation />);
    expect(html).toContain("Licença ativada");
    expect(html).not.toContain("Licença liberada");
    expect(html).not.toContain("<button");
    expect(html).toContain("Retorno do fornecedor: Success");
    expect(html).not.toContain("<strong>Success</strong>");
    expect(html).toContain("conta UnlockTool informada");
    expect(html).not.toContain("Guarde essas informações");
    expect(html).not.toContain("período de uso");
    expect(html).not.toContain("somente nas condições");
  });
  it("licença + retorno vazio: não mostra linha de retorno nem botão", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery deliveryType="LICENSE" title="UnlockTool — Licença 3 meses" licenseActivation />,
    );
    expect(html).toContain("Licença ativada");
    expect(html).not.toContain("Retorno do fornecedor");
    expect(html).not.toContain("<button");
  });
  it("sem licenseActivation o comportamento anterior é preservado (título, copiar e instruções)", () => {
    const html = renderToStaticMarkup(<CredentialDelivery {...success} />);
    expect(html).toContain("Licença liberada");
    expect(html).toContain("<button");
    expect(html).toContain("<strong>Success</strong>");
    expect(html).toContain("somente nas condições");
    expect(html).not.toContain("Licença ativada");
  });
  it("credenciais de aluguel continuam iguais", () => {
    const html = renderToStaticMarkup(
      <CredentialDelivery
        deliveryType="CREDENTIALS"
        title="UnlockTool 6h"
        deliveryFields={[
          { key: "username", label: "Usuário/Login", value: "u1", sensitive: false },
          { key: "password", label: "Senha", value: "p1", sensitive: true },
        ]}
      />,
    );
    expect(html).toContain("Acesso liberado");
    expect(html).toContain("u1");
    expect(html).toContain("<button");
  });
});
