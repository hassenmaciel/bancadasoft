import { PaymentStatus } from "@prisma/client";
import { AsaasClient, AsaasClientError, ASAAS_PRODUCTION_BASE_URL, ASAAS_SANDBOX_BASE_URL } from "./asaas-client";
import type {
  ParsedPaymentWebhook,
  PaymentProvider,
  PaymentStatusResult,
  PixPaymentInput,
  PixPaymentDetails,
  PixPaymentResult,
} from "./types";
import { PaymentProviderNotConnectedError, PixPaymentReconciliationRequiredError } from "./types";

export const ASAAS_API_BASE_URL = ASAAS_SANDBOX_BASE_URL;
type CustomerResponse = { id?: string };
type PaymentResponse = { id?: string; status?: string };
type PixResponse = {
  payload?: string;
  encodedImage?: string;
  expirationDate?: string;
};
export const mapAsaasStatus = (status: string): PaymentStatus =>
  status === "RECEIVED"
    ? PaymentStatus.PAID
    : status === "OVERDUE"
      ? PaymentStatus.EXPIRED
      : status === "REFUNDED"
        ? PaymentStatus.REFUNDED
        : ["DELETED", "FAILED"].includes(status)
          ? PaymentStatus.FAILED
          : PaymentStatus.PENDING;
export const mapAsaasEvent = (event: string): PaymentStatus | null =>
  event === "PAYMENT_RECEIVED"
    ? PaymentStatus.PAID
    : event === "PAYMENT_OVERDUE"
      ? PaymentStatus.EXPIRED
      : event === "PAYMENT_REFUNDED"
        ? PaymentStatus.REFUNDED
        : event === "PAYMENT_DELETED"
          ? PaymentStatus.FAILED
          : event === "PAYMENT_CREATED"
            ? PaymentStatus.PENDING
            : null;

export class AsaasPaymentProvider implements PaymentProvider {
  readonly code = "asaas";
  readonly connected: boolean;
  constructor(private readonly client: AsaasClient | null = null,private readonly pixOptions:{maxAttempts?:number;wait?:(milliseconds:number)=>Promise<void>}={}) {
    this.connected = !!client;
  }
  async getPixPaymentDetails(externalPaymentId:string):Promise<PixPaymentDetails>{
    const client=this.configured();const maxAttempts=this.pixOptions.maxAttempts??3;const wait=this.pixOptions.wait??((milliseconds:number)=>new Promise<void>((resolve)=>setTimeout(resolve,milliseconds)));
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      try{const qr=await client.request<PixResponse>(`/payments/${encodeURIComponent(externalPaymentId)}/pixQrCode`);if(!qr.payload||!qr.expirationDate)throw new Error("ASAAS_INVALID_PIX_RESPONSE");return{externalPaymentId,pixCode:qr.payload,qrCode:qr.encodedImage,expiresAt:new Date(qr.expirationDate)};}
      catch(error){const retryable=error instanceof AsaasClientError&&error.status===400&&error.providerReason==="PIX_NOT_READY";if(!retryable||attempt===maxAttempts)throw error;await wait(attempt*400);}
    }
    throw new Error("ASAAS_INVALID_PIX_RESPONSE");
  }
  private configured() {
    if (!this.client) throw new PaymentProviderNotConnectedError(this.code);
    return this.client;
  }
  async createPixPayment(input: PixPaymentInput): Promise<PixPaymentResult> {
    const client = this.configured();
    let customerId = input.customer.externalCustomerId;
    if (!customerId) {
      if (!input.customer.cpfCnpj)
        throw new Error("ASAAS_CUSTOMER_DOCUMENT_REQUIRED");
      const customer = await client.request<CustomerResponse>("/customers", {
        method: "POST",
        body: JSON.stringify({
          name: input.customer.name,
          cpfCnpj: input.customer.cpfCnpj,
          email: input.customer.email,
          mobilePhone: input.customer.mobilePhone,
          externalReference: input.customer.internalId,
          notificationDisabled: true,
        }),
      });
      if (!customer.id) throw new Error("ASAAS_INVALID_CUSTOMER_RESPONSE");
      customerId = customer.id;
    }
    const dueDate = input.expiresAt.toISOString().slice(0, 10);
    const payment = await client.request<PaymentResponse>("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value: input.amountCents / 100,
        dueDate,
        description: `Pedido BancadaSoft ${input.orderId}`,
        externalReference: input.orderId,
      }),
    });
    if (!payment.id) throw new Error("ASAAS_INVALID_PAYMENT_RESPONSE");
    let qr:PixPaymentDetails;
    try{qr=await this.getPixPaymentDetails(payment.id);}catch(error){const providerCode=error instanceof AsaasClientError?error.providerReason??error.message:"ASAAS_PIX_LOOKUP_FAILED";throw new PixPaymentReconciliationRequiredError(payment.id,customerId,providerCode);}
    return {
      externalPaymentId: payment.id,
      externalCustomerId: customerId,
      status: mapAsaasStatus(payment.status ?? "PENDING"),
      pixCode: qr.pixCode,
      qrCode: qr.qrCode,
      expiresAt: qr.expiresAt,
    };
  }
  async getPaymentStatus(
    externalPaymentId: string,
  ): Promise<PaymentStatusResult> {
    const payment = await this.configured().request<PaymentResponse>(
      `/payments/${encodeURIComponent(externalPaymentId)}`,
    );
    if (!payment.id || !payment.status)
      throw new Error("ASAAS_INVALID_PAYMENT_RESPONSE");
    return {
      externalPaymentId: payment.id,
      status: mapAsaasStatus(payment.status),
    };
  }
  validateWebhook(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const value = payload as Record<string, unknown>;
    const payment = value.payment as Record<string, unknown> | undefined;
    return (
      typeof value.id === "string" &&
      typeof value.event === "string" &&
      !!mapAsaasEvent(value.event) &&
      typeof payment?.id === "string"
    );
  }
  parseWebhook(payload: unknown): ParsedPaymentWebhook {
    if (!this.validateWebhook(payload))
      throw new Error("INVALID_ASAAS_WEBHOOK");
    const value = payload as Record<string, unknown>;
    const payment = value.payment as Record<string, unknown>;
    return {
      provider: this.code,
      providerEventId: String(value.id),
      orderId:
        typeof payment.externalReference === "string"
          ? payment.externalReference
          : undefined,
      externalPaymentId: String(payment.id),
      status: mapAsaasEvent(String(value.event))!,
      payload: value,
    };
  }
}

export function createConfiguredAsaasProvider(env: NodeJS.ProcessEnv = process.env) {
  const key = env.ASAAS_API_KEY?.trim();
  const environment = env.ASAAS_ENV?.trim().toLowerCase() ?? "sandbox";
  if (!key || (environment !== "sandbox" && environment !== "production"))
    return new AsaasPaymentProvider();
  const expectedBaseUrl = environment === "production"
    ? ASAAS_PRODUCTION_BASE_URL
    : ASAAS_SANDBOX_BASE_URL;
  const baseUrl = (env.ASAAS_BASE_URL?.trim() || expectedBaseUrl).replace(/\/+$/, "");
  if (baseUrl !== expectedBaseUrl) return new AsaasPaymentProvider();
  return new AsaasPaymentProvider(new AsaasClient(key, { baseUrl }));
}
