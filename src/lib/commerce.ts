import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductWhere } from "@/lib/catalog";
import { executeFulfillment } from "@/lib/fulfillment-engine";
import { configuredPaymentProviderCode, getPaymentProvider } from "@/lib/payments/registry";
import { paymentWebhookLookup, shouldProcessPaymentEvent, shouldStartFulfillment, transitionPayment } from "@/lib/payments/rules";
import type { ParsedPaymentWebhook } from "@/lib/payments/types";

export const catalogue=()=>prisma.product.findMany({where:publicProductWhere,include:{category:true},orderBy:{createdAt:"asc"}});
export const productsForAdmin=()=>prisma.product.findMany({include:{category:true},orderBy:{createdAt:"desc"}});
export const setProductAvailability=(id:string,available:boolean)=>prisma.product.update({where:{id},data:{available}});

export async function createOrder(input:{productId:string;name:string;email:string;whatsapp:string;cpfCnpj?:string}){
  const product=await prisma.product.findFirst({where:{id:input.productId,...publicProductWhere}});if(!product)return undefined;
  const user=await prisma.user.upsert({where:{email:input.email},update:{name:input.name},create:{email:input.email,name:input.name,passwordHash:"PENDING_INVITE"}});const providerCode=configuredPaymentProviderCode();const provider=getPaymentProvider(providerCode);if(!provider)throw new Error("PAYMENT_PROVIDER_UNAVAILABLE");const publicToken=crypto.randomUUID().replaceAll("-","");const expiresAt=new Date(Date.now()+900000);
  const pendingOrder=await prisma.order.create({data:{publicToken,customerId:user.id,totalCents:product.priceCents,items:{create:{productId:product.id,unitPriceCents:product.priceCents}},payment:{create:{provider:provider.code,providerReference:`pending:${publicToken}`,amountCents:product.priceCents,status:PaymentStatus.PENDING,pixCode:"",expiresAt}},events:{create:{status:OrderStatus.PENDING_PAYMENT,note:`Pagamento ${provider.code} em criação para ${input.whatsapp}.`}}},include:{payment:true}});
  const payment=await provider.createPixPayment({orderId:publicToken,amountCents:product.priceCents,expiresAt,customer:{internalId:user.id,name:user.name,email:user.email,cpfCnpj:input.cpfCnpj,externalCustomerId:user.asaasCustomerId??undefined}});
  await prisma.$transaction(async(tx)=>{if(provider.code==="asaas"&&payment.externalCustomerId&&!user.asaasCustomerId)await tx.user.update({where:{id:user.id},data:{asaasCustomerId:payment.externalCustomerId}});await tx.payment.update({where:{orderId:pendingOrder.id},data:{providerReference:payment.externalPaymentId,externalPaymentId:payment.externalPaymentId,status:payment.status,pixCode:payment.pixCode,qrCode:payment.qrCode,expiresAt:payment.expiresAt}});await tx.orderEvent.create({data:{orderId:pendingOrder.id,status:OrderStatus.PENDING_PAYMENT,note:`PIX ${provider.code} criado.`}});});
  return getOrder(pendingOrder.id);
}
export const getOrder=(id:string)=>prisma.order.findUnique({where:{id},include:{items:{include:{product:{include:{category:true}}}},payment:true,fulfillment:true,events:{orderBy:{createdAt:"asc"}}}});

export async function processPayment(event:ParsedPaymentWebhook){
  const lookup=paymentWebhookLookup(event);let payment=lookup.external?await prisma.payment.findFirst({where:lookup.external,include:{order:true}}):null;if(!payment&&lookup.reference)payment=await prisma.payment.findFirst({where:lookup.reference,include:{order:true}});if(!payment)return undefined;
  const existing=await prisma.paymentEvent.findUnique({where:{providerEventId:event.providerEventId}});if(!shouldProcessPaymentEvent(!!existing))return{duplicate:true,order:await getOrder(payment.orderId)};
  const nextStatus=transitionPayment(payment.status,event.status);const startFulfillment=payment.status!==PaymentStatus.PAID&&shouldStartFulfillment(nextStatus);const paymentData={status:nextStatus,...(!payment.externalPaymentId&&event.externalPaymentId?{externalPaymentId:event.externalPaymentId,providerReference:event.externalPaymentId}:{})};
  try{if(startFulfillment){await prisma.$transaction([prisma.paymentEvent.create({data:{providerEventId:event.providerEventId,paymentId:payment.id,payload:event.payload as Prisma.InputJsonValue}}),prisma.payment.update({where:{id:payment.id},data:paymentData}),prisma.order.update({where:{id:payment.orderId},data:{status:OrderStatus.PAID,events:{create:{status:OrderStatus.PAID,note:`Pagamento ${payment.provider} confirmado.`}}}})]);}else{await prisma.$transaction([prisma.paymentEvent.create({data:{providerEventId:event.providerEventId,paymentId:payment.id,payload:event.payload as Prisma.InputJsonValue}}),prisma.payment.update({where:{id:payment.id},data:paymentData})]);}}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002")return{duplicate:true,order:await getOrder(payment.orderId)};throw error;}
  if(startFulfillment){try{await executeFulfillment(payment.orderId);}catch{/* PAID remains committed; fulfillment failure is persisted by the engine */}}
  return{duplicate:false,order:await getOrder(payment.orderId)};
}
