import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  deliveryNotification: { create: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../prisma", () => ({ prisma: db }));
import { createDeliveryAccess, decryptDeliveryToken } from "../guest-delivery";
import { secureDeliveryUrl } from "./delivery";
import { deliveryEmailContent, resendDeliveryEmail, sendDeliveryEmail } from "./delivery-email";

const base = {
  customerName: "Cliente <Teste>",
  orderNumber: "ABCD1234",
  productName: "Phoenix Service Tool",
  recipientEmail: "cliente@example.com",
  secureUrl: "https://www.bancadasoft.com.br/acompanhar/order-1#token=safe",
};
const STYLE = 'style="font-family:Arial,sans-serif;color:#10213b;max-width:600px;margin:auto"';
const BUTTON = 'style="display:inline-block;background:#0878f9;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold"';

describe("baseline: conteúdo atual dos e-mails (idêntico)", () => {
  it("e-mail genérico", () => {
    expect(deliveryEmailContent(base)).toEqual({
      subject: "BancadaSoft — Seu acesso Phoenix Service Tool foi liberado",
      html: `<div ${STYLE}><h1 style="color:#0878f9">BancadaSoft</h1><p>Olá, Cliente &lt;Teste&gt;.</p><p>Seu acesso a Phoenix Service Tool foi liberado.</p><p><strong>Pedido:</strong> ABCD1234</p><p><a href="https://www.bancadasoft.com.br/acompanhar/order-1#token=safe" ${BUTTON}>ACESSAR MEU LOGIN</a></p><p>Por segurança, não compartilhe este link.</p><p>BancadaSoft<br>Encontrou. Pagou. Liberou.</p></div>`,
      text: "Olá, Cliente <Teste>.\n\nSeu acesso a Phoenix Service Tool foi liberado.\n\nPedido: ABCD1234\n\nAcesse seu login com segurança:\nhttps://www.bancadasoft.com.br/acompanhar/order-1#token=safe\n\nPor segurança, não compartilhe este link.\n\nBancadaSoft\nEncontrou. Pagou. Liberou.",
    });
  });
  it("e-mail de licença UnlockTool", () => {
    expect(deliveryEmailContent({ ...base, productName: "UnlockTool — Licença 3 meses", licenseActivation: { username: "tecnico01" } })).toEqual({
      subject: "BancadaSoft — Licença UnlockTool — Licença 3 meses ativada",
      html: `<div ${STYLE}><h1 style="color:#0878f9">BancadaSoft</h1><p>Olá, Cliente &lt;Teste&gt;.</p><p>Sua licença UnlockTool — Licença 3 meses foi ativada/renovada na conta UnlockTool informada no pedido.</p><p><strong>Usuário da conta UnlockTool:</strong> tecnico01</p><p><strong>Pedido:</strong> ABCD1234</p><p><a href="https://www.bancadasoft.com.br/acompanhar/order-1#token=safe" ${BUTTON}>VER DETALHES DO PEDIDO</a></p><p>Por segurança, não compartilhe este link.</p><p>BancadaSoft<br>Encontrou. Pagou. Liberou.</p></div>`,
      text: "Olá, Cliente <Teste>.\n\nSua licença UnlockTool — Licença 3 meses foi ativada/renovada na conta UnlockTool informada no pedido.\n\nUsuário da conta UnlockTool: tecnico01\n\nPedido: ABCD1234\n\nVeja os detalhes do pedido com segurança:\nhttps://www.bancadasoft.com.br/acompanhar/order-1#token=safe\n\nPor segurança, não compartilhe este link.\n\nBancadaSoft\nEncontrou. Pagou. Liberou.",
    });
  });
});

describe("e-mail de confirmação de créditos (conteúdo)", () => {
  const instructions = "O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.";
  it("assunto, saudação, a mesma frase gravada, pedido e botão VER DETALHES DO PEDIDO", () => {
    expect(deliveryEmailContent({ ...base, creditConfirmation: { instructions } })).toEqual({
      subject: "BancadaSoft — Créditos de Phoenix Service Tool confirmados",
      html: `<div ${STYLE}><h1 style="color:#0878f9">BancadaSoft</h1><p>Olá, Cliente &lt;Teste&gt;.</p><p>O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.</p><p><strong>Pedido:</strong> ABCD1234</p><p><a href="https://www.bancadasoft.com.br/acompanhar/order-1#token=safe" ${BUTTON}>VER DETALHES DO PEDIDO</a></p><p>Por segurança, não compartilhe este link.</p><p>BancadaSoft<br>Encontrou. Pagou. Liberou.</p></div>`,
      text: "Olá, Cliente <Teste>.\n\nO fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.\n\nPedido: ABCD1234\n\nVeja os detalhes do pedido com segurança:\nhttps://www.bancadasoft.com.br/acompanhar/order-1#token=safe\n\nPor segurança, não compartilhe este link.\n\nBancadaSoft\nEncontrou. Pagou. Liberou.",
    });
  });
  it("escapa <script> da conta no HTML (sem máscara)", () => {
    const content = deliveryEmailContent({
      ...base,
      creditConfirmation: { instructions: "O fornecedor confirmou o pedido de 5 créditos para a conta <script>alert(1)</script>@t.com." },
    });
    expect(content.html).not.toContain("<script>");
    expect(content.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;@t.com.");
    expect(content.text).toContain("<script>alert(1)</script>@t.com.");
  });
  it("produto com caracteres especiais no assunto: sem escape no assunto, escapado no HTML", () => {
    const content = deliveryEmailContent({ ...base, productName: "A & B", creditConfirmation: { instructions } });
    expect(content.subject).toBe("BancadaSoft — Créditos de A & B confirmados");
  });
  it("licença tem precedência sobre a confirmação", () => {
    const content = deliveryEmailContent({ ...base, licenseActivation: { username: "x" }, creditConfirmation: { instructions } });
    expect(content.subject).toContain("ativada");
  });
});

describe("sendDeliveryEmail / resendDeliveryEmail: detecção pelo marcador", () => {
  const transport = { send: vi.fn() };
  const options = { apiKey: "key", from: "from@example.com", transport };
  let access: ReturnType<typeof createDeliveryAccess>;
  const order = (product: unknown, delivery: unknown, providerFields: unknown = null) => ({
    id: "order-1",
    publicToken: "publictoken",
    status: "DELIVERED",
    deliveryTokenHash: access.tokenHash,
    deliveryTokenEncrypted: access.encryptedToken,
    deliveryTokenExpiresAt: access.expiresAt,
    deliveryTokenRevokedAt: null,
    deliveryNotifiedAt: null,
    customer: { name: "Cliente", email: "cliente@example.com" },
    items: [{ product, providerFields }],
    fulfillment: { delivery },
  });
  const phoenix = { name: "Phoenix Service Tool", type: "CREDIT", brand: { name: "Phoenix ServiceTool" } };
  const confirmed = {
    kind: "provider-delivery",
    deliveryType: "TEXT",
    title: "Phoenix Service Tool",
    instructions: "O fornecedor confirmou o pedido de 5 créditos para a conta teste@teste.com.",
    confirmation: true,
  };
  const sent = () => transport.send.mock.calls[0][0];
  const url = () => secureDeliveryUrl("https://www.bancadasoft.com.br", "order-1", decryptDeliveryToken(access.encryptedToken)!);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "isolated-email-test-secret-with-32-bytes";
    access = createDeliveryAccess(new Date(), "delivery-token-for-confirmation-tests");
    db.deliveryNotification.create.mockResolvedValue({ id: "n-1" });
    db.deliveryNotification.upsert.mockResolvedValue({ id: "n-1" });
    db.deliveryNotification.updateMany.mockResolvedValue({ count: 1 });
    db.deliveryNotification.update.mockResolvedValue({});
    db.order.update.mockResolvedValue({});
    db.siteSettings.findUnique.mockResolvedValue({ domain: "www.bancadasoft.com.br" });
    db.$transaction.mockImplementation((items: unknown[]) => Promise.all(items));
    transport.send.mockResolvedValue({ messageId: "m-1" });
  });

  it("entrega com confirmation: true usa o modelo de confirmação com a frase gravada e o mesmo link", async () => {
    db.order.findUnique.mockResolvedValue(order(phoenix, confirmed));
    expect(await sendDeliveryEmail("order-1", options)).toEqual({ status: "SENT" });
    expect(sent().subject).toBe("BancadaSoft — Créditos de Phoenix Service Tool confirmados");
    expect(sent().text).toContain(confirmed.instructions);
    expect(sent().text).toContain(url());
    expect(sent().html).toContain("VER DETALHES DO PEDIDO");
  });
  it("reenvio pelo Admin também usa o modelo de confirmação", async () => {
    db.order.findUnique.mockResolvedValue(order(phoenix, confirmed));
    await resendDeliveryEmail("order-1", { ...options, now: new Date() });
    expect(sent().subject).toBe("BancadaSoft — Créditos de Phoenix Service Tool confirmados");
  });
  it("Phoenix entregue com retorno textual (sem marcador): e-mail genérico idêntico", async () => {
    const textual = { kind: "provider-delivery", deliveryType: "TEXT", title: "Phoenix Service Tool", deliveryFields: [{ key: "credits_added", label: "Credits added", value: "5", sensitive: false }] };
    db.order.findUnique.mockResolvedValue(order({ ...phoenix, acceptsSuccessWithoutText: true }, textual));
    await sendDeliveryEmail("order-1", options);
    const { from: _from, to: _to, ...content } = sent();
    expect(content).toEqual(
      deliveryEmailContent({ customerName: "Cliente", orderNumber: "PUBLICTO", productName: "Phoenix Service Tool", recipientEmail: "cliente@example.com", secureUrl: url() }),
    );
    expect(content.subject).toBe("BancadaSoft — Seu acesso Phoenix Service Tool foi liberado");
  });
  it.each([
    ["confirmation ausente", { ...confirmed, confirmation: undefined }],
    ['confirmation "true" (string)', { ...confirmed, confirmation: "true" }],
    ["marcador sem instructions", { ...confirmed, instructions: undefined }],
  ])("%s: e-mail genérico", async (_label, delivery) => {
    db.order.findUnique.mockResolvedValue(order(phoenix, delivery));
    await sendDeliveryEmail("order-1", options);
    expect(sent().subject).toBe("BancadaSoft — Seu acesso Phoenix Service Tool foi liberado");
  });
  it("licença UnlockTool com marcador (hipotético): continua o e-mail de licença", async () => {
    const license = { name: "UnlockTool — Licença 3 meses", type: "LICENSE", brand: { name: "UnlockTool" } };
    db.order.findUnique.mockResolvedValue(order(license, confirmed, { Username: "tecnico01" }));
    await sendDeliveryEmail("order-1", options);
    expect(sent().subject).toBe("BancadaSoft — Licença UnlockTool — Licença 3 meses ativada");
    expect(sent().text).toContain("Usuário da conta UnlockTool: tecnico01");
  });
});
