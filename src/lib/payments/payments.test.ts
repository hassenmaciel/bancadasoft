import { describe, expect, it } from "vitest";
import { PaymentStatus } from "@prisma/client";
import { AsaasPaymentProvider, ASAAS_API_BASE_URL } from "./asaas";
import { MockPaymentProvider } from "./mock";
import { configuredPaymentProviderCode, getPaymentProvider } from "./registry";
import { paymentWebhookLookup, shouldProcessPaymentEvent, shouldStartFulfillment, transitionPayment } from "./rules";
import type { PaymentProvider } from "./types";

const customer = { internalId: "user-1", name: "Cliente Teste", email: "cliente@example.test" };

describe("MockPaymentProvider", () => {
  it("cria PIX pendente", async () => {
    const payment = await new MockPaymentProvider().createPixPayment({ orderId: "order-1", amountCents: 2900, expiresAt: new Date("2026-09-10T12:00:00Z"), customer });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.pixCode).toContain("PIX-MOCK");
  });
  it("interpreta transição PENDING para PAID", () => expect(transitionPayment(PaymentStatus.PENDING, PaymentStatus.PAID)).toBe(PaymentStatus.PAID));
  it("não dispara fulfillment para EXPIRED", () => expect(shouldStartFulfillment(PaymentStatus.EXPIRED)).toBe(false));
  it("não dispara fulfillment para FAILED", () => expect(shouldStartFulfillment(PaymentStatus.FAILED)).toBe(false));
  it("permite fulfillment para PAID", () => expect(shouldStartFulfillment(PaymentStatus.PAID)).toBe(true));
  it("rejeita processamento duplicado do mesmo evento", () => { expect(shouldProcessPaymentEvent(true)).toBe(false); expect(shouldProcessPaymentEvent(false)).toBe(true); });
});

describe("registry de pagamentos", () => {
  it("retorna o provider mock", () => expect(getPaymentProvider("mock")).toBeInstanceOf(MockPaymentProvider));
  it("mantém Asaas desconectado sem depender de chave", async () => {
    const provider = new AsaasPaymentProvider();
    expect(provider.connected).toBe(false);
    expect(ASAAS_API_BASE_URL).toBe("https://api-sandbox.asaas.com/v3");
    expect(Object.keys(provider)).not.toContain("apiKey");
    await expect(provider.createPixPayment({ orderId: "o", amountCents: 1, expiresAt: new Date(), customer })).rejects.toThrow("não conectado");
  });
  it("permite outro provider sem acoplamento ao Asaas", () => { const custom: PaymentProvider = new MockPaymentProvider(); expect(custom.code).toBe("mock"); expect(custom).not.toBeInstanceOf(AsaasPaymentProvider); });
  it("seleciona Asaas Sandbox quando configurado", () => expect(configuredPaymentProviderCode({ ASAAS_ENV: "sandbox", ASAAS_API_KEY: "test-key" })).toBe("asaas"));
  it("mantém Mock quando selecionado explicitamente", () => expect(configuredPaymentProviderCode({ PAYMENT_PROVIDER: "mock", ASAAS_ENV: "sandbox", ASAAS_API_KEY: "test-key" })).toBe("mock"));
  it("não converte configuração explícita inválida em Mock", () => expect(configuredPaymentProviderCode({ PAYMENT_PROVIDER: "invalid", ASAAS_ENV: "sandbox", ASAAS_API_KEY: "test-key" })).toBe("invalid"));
});

describe("localização do pagamento por webhook", () => {
  const event = { provider: "asaas", providerEventId: "evt-real", externalPaymentId: "pay-real", orderId: "public-token", status: PaymentStatus.PENDING, payload: {} };
  it("webhook Asaas localiza Payment usando payment.id como externalPaymentId", () => {
    expect(paymentWebhookLookup(event).external).toEqual({ externalPaymentId: "pay-real", provider: "asaas" });
  });
  it("externalReference não substitui externalPaymentId", () => {
    const lookup = paymentWebhookLookup(event);
    expect(lookup.reference).toEqual({ provider: "asaas", order: { publicToken: "public-token" } });
    expect(lookup.external?.externalPaymentId).not.toBe(event.orderId);
  });
});
