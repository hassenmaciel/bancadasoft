import { PaymentStatus } from "@prisma/client";
import type { ParsedPaymentWebhook } from "./types";
export const shouldStartFulfillment=(status:PaymentStatus)=>status===PaymentStatus.PAID;
// Um pagamento confirmado depois da expiração local NUNCA é descartado: o dinheiro entrou.
export const isPaidAfterExpiry=(current:PaymentStatus,next:PaymentStatus)=>current===PaymentStatus.EXPIRED&&next===PaymentStatus.PAID;
export const transitionPayment=(current:PaymentStatus,next:PaymentStatus)=>current===PaymentStatus.PENDING||isPaidAfterExpiry(current,next)?next:current;
export const shouldProcessPaymentEvent=(eventAlreadyExists:boolean)=>!eventAlreadyExists;
export const paymentWebhookLookup=(event:ParsedPaymentWebhook)=>({
  external:event.externalPaymentId?{externalPaymentId:event.externalPaymentId,provider:event.provider}:null,
  reference:event.orderId?{provider:event.provider,order:{publicToken:event.orderId}}:null,
});
