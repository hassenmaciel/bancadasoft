import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  deliveryNotification: {
    create: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  siteSettings: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../prisma", () => ({ prisma: db }));
import { createDeliveryAccess } from "../guest-delivery";
import { deliveryEmailContent, sendDeliveryEmail } from "./delivery-email";

const base = {
  customerName: "Cliente",
  orderNumber: "PUBLIC",
  productName: "UnlockTool — Licença 3 meses",
  recipientEmail: "cliente@example.com",
  secureUrl: "https://www.bancadasoft.com.br/acompanhar/order#token=safe",
};

describe("e-mail de licença UnlockTool (conteúdo)", () => {
  it("corpo próprio: ativada/renovada, sem login, sem código, com usuário quando disponível", () => {
    const content = deliveryEmailContent({ ...base, licenseActivation: { username: "tecnico01" } });
    const all = `${content.subject}${content.html}${content.text}`;
    expect(content.subject).toContain("ativada");
    expect(all).toContain("ativada/renovada na conta UnlockTool");
    expect(all).toContain("tecnico01");
    expect(all).toContain("/acompanhar/order#token=");
    expect(all.toLowerCase()).not.toContain("login");
    expect(all.toLowerCase()).not.toContain("código");
  });
  it("retorno vazio / sem usuário disponível: omite a linha da conta", () => {
    const content = deliveryEmailContent({ ...base, licenseActivation: { username: null } });
    const all = `${content.html}${content.text}`;
    expect(all).not.toContain("Usuário da conta UnlockTool");
    expect(all).toContain("ativada/renovada");
  });
  it("escapa HTML no usuário", () => {
    const content = deliveryEmailContent({ ...base, licenseActivation: { username: "<b>x</b>" } });
    expect(content.html).not.toContain("<b>x</b>");
    expect(content.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
  it("sem licenseActivation o e-mail continua idêntico ao anterior", () => {
    const content = deliveryEmailContent({ ...base, productName: "UnlockTool 6 horas" });
    expect(content.subject).toBe("BancadaSoft — Seu acesso UnlockTool 6 horas foi liberado");
    expect(content.html).toContain("ACESSAR MEU LOGIN");
    expect(content.text).toContain("Acesse seu login com segurança:");
  });
});

describe("sendDeliveryEmail: gating por marca + tipo", () => {
  const transport = { send: vi.fn() };
  const order = (item: unknown) => ({
    id: "order-1",
    publicToken: "publictoken",
    status: "DELIVERED",
    deliveryTokenEncrypted: createDeliveryAccess(
      new Date(),
      "delivery-token-for-email-tests-12345",
    ).encryptedToken,
    deliveryNotifiedAt: null,
    customer: { name: "Cliente", email: "cliente@example.com" },
    items: [item],
    fulfillment: { delivery: { deliveryType: "LICENSE" } },
  });
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_SECRET = "isolated-email-test-secret-with-32-bytes";
    db.deliveryNotification.create.mockResolvedValue({ id: "notification-1" });
    db.deliveryNotification.updateMany.mockResolvedValue({ count: 1 });
    db.deliveryNotification.update.mockResolvedValue({});
    db.order.update.mockResolvedValue({});
    db.siteSettings.findUnique.mockResolvedValue({ domain: "www.bancadasoft.com.br" });
    db.$transaction.mockImplementation((items: unknown[]) => Promise.all(items));
    transport.send.mockResolvedValue({ messageId: "m1" });
  });
  const send = () =>
    sendDeliveryEmail("order-1", { apiKey: "k", from: "f@example.com", transport });

  it("licença UnlockTool: corpo de licença com o usuário da conta (sem o e-mail da conta)", async () => {
    db.order.findUnique.mockResolvedValueOnce(
      order({
        providerFields: { Email: "conta@example.com", Username: "tecnico01" },
        product: { name: "UnlockTool — Licença 3 meses", type: "LICENSE", brand: { name: "UnlockTool" } },
      }),
    );
    await send();
    const sent = transport.send.mock.calls[0][0];
    expect(sent.subject).toContain("ativada");
    expect(sent.text).toContain("tecnico01");
    expect(sent.text).not.toContain("conta@example.com");
  });
  it.each([
    ["unlocktool-6h (aluguel)", "UnlockTool 6 horas", "RENTAL", "UnlockTool"],
    ["SamsungTool KG (LICENSE de outra marca)", "SamsungTool — KG Bypass", "LICENSE", "SamsungTool"],
    ["Phoenix", "Phoenix Service Tool", "TOOL", "Phoenix ServiceTool"],
  ])("%s: e-mail idêntico ao de sempre", async (_label, name, type, brand) => {
    db.order.findUnique.mockResolvedValueOnce(
      order({ providerFields: { Username: "u" }, product: { name, type, brand: { name: brand } } }),
    );
    await send();
    const sent = transport.send.mock.calls[0][0];
    expect(sent.subject).toBe(`BancadaSoft — Seu acesso ${name} foi liberado`);
    expect(sent.text).toContain("Acesse seu login com segurança:");
  });
});
