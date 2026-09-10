import { PaymentStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAsaasWebhook } from "./asaas-route";

const token = "isolated-webhook-secret";
const realPayload = {
  id: "evt-diagnostic-e2e",
  event: "PAYMENT_CREATED",
  payment: { id: "pay_3leccoemc3vpg7qy", externalReference: "diagnostic-e2e", value: 5, status: "PENDING", billingType: "PIX" },
};
const request = (payload: unknown, accessToken = token) => new Request("http://localhost/api/webhooks/payments/asaas", { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": accessToken }, body: JSON.stringify(payload) });

afterEach(() => vi.unstubAllEnvs());

describe("webhook Asaas", () => {
  it("reconhece PAYMENT_CREATED autêntico sem Payment correspondente", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const processor = vi.fn(async () => undefined);
    const response = await handleAsaasWebhook(request(realPayload), processor);
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ received: true, ignored: true, unmatched: true }); expect(processor).toHaveBeenCalledOnce();
  });
  it("preserva payment.id e externalReference desconhecidos sem criar entidades", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const processor = vi.fn(async () => undefined); await handleAsaasWebhook(request(realPayload), processor);
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ provider: "asaas", externalPaymentId: "pay_3leccoemc3vpg7qy", orderId: "diagnostic-e2e", status: PaymentStatus.PENDING }));
  });
  it("mantém o processamento normal de evento conhecido", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const response = await handleAsaasWebhook(request(realPayload), async () => ({ duplicate: false, order: {} }));
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ received: true, duplicate: false });
  });
  it("mapeia PAYMENT_RECEIVED conhecido para PAID", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const processor = vi.fn(async () => ({ duplicate: false, order: {} })); await handleAsaasWebhook(request({ ...realPayload, id: "evt-received", event: "PAYMENT_RECEIVED" }), processor);
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ status: PaymentStatus.PAID }));
  });
  it("preserva a resposta idempotente do processador", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const response = await handleAsaasWebhook(request(realPayload), async () => ({ duplicate: true, order: {} })); await expect(response.json()).resolves.toEqual({ received: true, duplicate: true });
  });
  it("rejeita autenticação inválida antes do processamento", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const processor = vi.fn(async () => undefined); const response = await handleAsaasWebhook(request(realPayload, "invalid-token"), processor); expect(response.status).toBe(401); expect(processor).not.toHaveBeenCalled();
  });
  it("rejeita payload estruturalmente inválido", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); const response = await handleAsaasWebhook(request({ event: "PAYMENT_CREATED" }), async () => undefined); expect(response.status).toBe(422);
  });
  it("não converte erro interno real em sucesso", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", token); await expect(handleAsaasWebhook(request(realPayload), async () => { throw new Error("DATABASE_UNAVAILABLE"); })).rejects.toThrow("DATABASE_UNAVAILABLE");
  });
});
