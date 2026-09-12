import type { PaymentStatus } from "@prisma/client";

export type PaymentCustomer={internalId:string;name:string;email:string;cpfCnpj?:string;mobilePhone?:string;externalCustomerId?:string};
export type PixPaymentInput={orderId:string;amountCents:number;expiresAt:Date;customer:PaymentCustomer};
export type PixPaymentResult={externalPaymentId:string;externalCustomerId?:string;status:PaymentStatus;pixCode:string;qrCode?:string;expiresAt:Date};
export type PixPaymentDetails={externalPaymentId:string;pixCode:string;qrCode?:string;expiresAt:Date};
export type PaymentStatusResult={externalPaymentId:string;status:PaymentStatus};
export type ParsedPaymentWebhook={provider:string;providerEventId:string;orderId?:string;externalPaymentId?:string;status:PaymentStatus;payload:Record<string,unknown>};
export interface PaymentProvider{readonly code:string;createPixPayment(input:PixPaymentInput):Promise<PixPaymentResult>;getPixPaymentDetails?(externalPaymentId:string):Promise<PixPaymentDetails>;getPaymentStatus(externalPaymentId:string):Promise<PaymentStatusResult>;validateWebhook(payload:unknown):boolean;parseWebhook(payload:unknown):ParsedPaymentWebhook;}
export class PaymentProviderNotConnectedError extends Error{constructor(code:string){super(`Payment provider ${code} não conectado.`);this.name="PaymentProviderNotConnectedError";}}
export class PixPaymentReconciliationRequiredError extends Error{
  constructor(public readonly externalPaymentId:string,public readonly externalCustomerId:string|undefined,public readonly providerCode:string){super("PIX_PAYMENT_RECONCILIATION_REQUIRED");this.name="PixPaymentReconciliationRequiredError";}
}
