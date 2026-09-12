import { PaymentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AsaasClient, AsaasClientError, ASAAS_PRODUCTION_BASE_URL, ASAAS_SANDBOX_BASE_URL } from "./asaas-client";
import { AsaasPaymentProvider, createConfiguredAsaasProvider, mapAsaasEvent, mapAsaasStatus } from "./asaas";
import { validateAsaasWebhookToken } from "./asaas-webhook";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const input = { orderId: "order-test", amountCents: 2990, expiresAt: new Date("2026-09-15T12:00:00Z"), customer: { internalId: "user-test", name: "Cliente Sandbox", email: "sandbox@example.test", cpfCnpj: "52998224725", mobilePhone:"5511999999999" } };

describe("AsaasClient", () => {
  it("usa a API Sandbox por padrão e envia os cabeçalhos exigidos", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = new AsaasClient("isolated-test-key", { fetcher });
    await client.request("/customers", { method: "POST", body: "{}" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(`${ASAAS_SANDBOX_BASE_URL}/customers`);
    expect(request.headers).toMatchObject({ access_token: "isolated-test-key", "user-agent": "BancadaSoft-Sandbox/1.0" });
  });

  it("bloqueia qualquer URL fora dos ambientes oficiais", () => {
    expect(() => new AsaasClient("isolated-test-key", { baseUrl: "https://example.test/v3" })).toThrowError("ASAAS_BASE_URL_NOT_ALLOWED");
  });

  it("usa a API Production quando o ambiente real foi configurado", async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = new AsaasClient("isolated-production-key", { baseUrl: ASAAS_PRODUCTION_BASE_URL, fetcher });
    await client.request("/customers");
    expect(fetcher.mock.calls[0][0]).toBe(`${ASAAS_PRODUCTION_BASE_URL}/customers`);
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ access_token: "isolated-production-key", "user-agent": "BancadaSoft-Production/1.0" });
  });

  it("normaliza erro HTTP sem expor corpo ou credencial", async () => {
    const client = new AsaasClient("secret-not-leaked", { fetcher: vi.fn(async () => json({ errors: [{ description: "sensitive" }] }, 401)) });
    await expect(client.request("/payments/x")).rejects.toEqual(expect.objectContaining<Partial<AsaasClientError>>({ status: 401, message: "ASAAS_HTTP_401" }));
  });
});

describe("AsaasPaymentProvider", () => {
  it("conecta por configuração em Production sem aceitar URL divergente", () => {
    expect(createConfiguredAsaasProvider({ ASAAS_ENV: "production", ASAAS_API_KEY: " isolated-production-key ", ASAAS_BASE_URL: `${ASAAS_PRODUCTION_BASE_URL}/` }).connected).toBe(true);
    expect(createConfiguredAsaasProvider({ ASAAS_ENV: "production", ASAAS_API_KEY: "isolated-production-key", ASAAS_BASE_URL: ASAAS_SANDBOX_BASE_URL }).connected).toBe(false);
  });
  it("cria cliente, cobrança PIX e consulta o QR Code", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ id: "cus_sandbox" }))
      .mockResolvedValueOnce(json({ id: "pay_sandbox", status: "PENDING" }))
      .mockResolvedValueOnce(json({ payload: "pix-copy-paste", encodedImage: "base64-image", expirationDate: "2026-09-15T23:59:59Z" }));
    const provider = new AsaasPaymentProvider(new AsaasClient("isolated-test-key", { fetcher }));
    const payment = await provider.createPixPayment(input);
    expect(payment).toMatchObject({ externalCustomerId: "cus_sandbox", externalPaymentId: "pay_sandbox", status: PaymentStatus.PENDING, pixCode: "pix-copy-paste", qrCode: "base64-image" });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const customerBody = JSON.parse(String(fetcher.mock.calls[0][1].body));
    const paymentBody = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(customerBody).toMatchObject({ name: "Cliente Sandbox", cpfCnpj: "52998224725", mobilePhone:"5511999999999", externalReference: "user-test", notificationDisabled: true });
    expect(paymentBody).toMatchObject({ customer: "cus_sandbox", billingType: "PIX", value: 29.9, dueDate: "2026-09-15", externalReference: "order-test" });
    expect(fetcher.mock.calls[2][0]).toBe(`${ASAAS_SANDBOX_BASE_URL}/payments/pay_sandbox/pixQrCode`);
  });

  it("reutiliza o customer externo persistido", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ id: "pay_reused", status: "PENDING" }))
      .mockResolvedValueOnce(json({ payload: "pix-reused", expirationDate: "2026-09-15T23:59:59Z" }));
    const provider = new AsaasPaymentProvider(new AsaasClient("isolated-test-key", { fetcher }));
    await provider.createPixPayment({ ...input, customer: { ...input.customer, cpfCnpj: undefined, externalCustomerId: "cus_existing" } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe(`${ASAAS_SANDBOX_BASE_URL}/payments`);
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).customer).toBe("cus_existing");
  });

  it("não inventa documento quando CPF/CNPJ não foi informado", async () => {
    const provider = new AsaasPaymentProvider(new AsaasClient("isolated-test-key", { fetcher: vi.fn() }));
    await expect(provider.createPixPayment({ ...input, customer: { ...input.customer, cpfCnpj: undefined } })).rejects.toThrow("ASAAS_CUSTOMER_DOCUMENT_REQUIRED");
  });

  it("interpreta webhook oficial e preserva seus identificadores", () => {
    const provider = new AsaasPaymentProvider(new AsaasClient("isolated-test-key", { fetcher: vi.fn() }));
    const parsed = provider.parseWebhook({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", externalReference: "order_1" } });
    expect(parsed).toMatchObject({ providerEventId: "evt_1", externalPaymentId: "pay_1", orderId: "order_1", status: PaymentStatus.PAID });
  });

  it("rejeita payload de webhook inválido", () => {
    const provider = new AsaasPaymentProvider(new AsaasClient("isolated-test-key", { fetcher: vi.fn() }));
    expect(provider.validateWebhook({ id: "evt_1", event: "UNKNOWN", payment: { id: "pay_1" } })).toBe(false);
    expect(() => provider.parseWebhook({ event: "PAYMENT_RECEIVED" })).toThrow("INVALID_ASAAS_WEBHOOK");
  });
});

describe("regras de segurança e status Asaas", () => {
  it("valida o token do webhook sem usar segredo do ambiente", () => {
    expect(validateAsaasWebhookToken("webhook-test-secret", "webhook-test-secret")).toBe(true);
    expect(validateAsaasWebhookToken("modified-secret", "webhook-test-secret")).toBe(false);
    expect(validateAsaasWebhookToken(null, "webhook-test-secret")).toBe(false);
  });

  it("somente PAYMENT_RECEIVED liquida o PIX", () => {
    expect(mapAsaasEvent("PAYMENT_RECEIVED")).toBe(PaymentStatus.PAID);
    expect(mapAsaasEvent("PAYMENT_CONFIRMED")).toBeNull();
    expect(mapAsaasStatus("RECEIVED")).toBe(PaymentStatus.PAID);
    expect(mapAsaasStatus("CONFIRMED")).toBe(PaymentStatus.PENDING);
  });
});
