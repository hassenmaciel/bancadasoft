import { FulfillmentStatus, OrderStatus, PaymentStatus, Prisma, ProviderIntegrationStatus, ProviderOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { selectProviderProduct } from "@/lib/providers/selection";
import { resolveProviderAdapter } from "@/lib/providers/registry";
import { MAX_PROVIDER_ATTEMPTS, providerOutcome, validateProviderExecution } from "@/lib/fulfillment-rules";

export class FulfillmentEngineError extends Error { constructor(public readonly code:string){super(code);this.name="FulfillmentEngineError";} }

export async function executeFulfillment(orderId:string,{retry=false}:{retry?:boolean}={}){
  const order=await prisma.order.findUnique({where:{id:orderId},include:{payment:true,fulfillment:{include:{providerOrders:true}},items:{include:{product:{include:{providerProducts:{include:{provider:true}}}}}}}});
  if(!order)throw new FulfillmentEngineError("ORDER_NOT_FOUND");
  const links=order.items.flatMap((item)=>item.product.providerProducts);
  const selected=selectProviderProduct(links);
  const existing=order.fulfillment?.providerOrders[0];
  const error=validateProviderExecution({orderExists:true,paymentStatus:order.payment?.status,orderStatus:order.status,hasProviderProduct:!!selected,providerActive:!!selected?.provider.active,providerConnected:selected?.provider.integrationStatus===ProviderIntegrationStatus.CONNECTED,providerOrderStatus:existing?.status,attempts:existing?.attempts??0,hasDelivery:!!order.fulfillment?.delivery},retry);
  if(error)throw new FulfillmentEngineError(error); if(!selected)throw new FulfillmentEngineError("PROVIDER_PRODUCT_NOT_FOUND");
  const adapter=resolveProviderAdapter(selected.provider.code);if(!adapter)throw new FulfillmentEngineError("PROVIDER_ADAPTER_UNAVAILABLE");
  const prepared=await prisma.$transaction(async(tx)=>{const fulfillment=await tx.fulfillment.upsert({where:{orderId},update:{},create:{orderId,provider:selected.provider.code,status:FulfillmentStatus.QUEUED}});const providerOrder=await tx.providerOrder.upsert({where:{fulfillmentId:fulfillment.id},update:{},create:{providerId:selected.providerId,providerProductId:selected.id,orderId,fulfillmentId:fulfillment.id,costCents:selected.providerCostCents,currency:selected.currency}});const claim=await tx.providerOrder.updateMany({where:{id:providerOrder.id,status:retry?ProviderOrderStatus.FAILED:ProviderOrderStatus.QUEUED,attempts:{lt:MAX_PROVIDER_ATTEMPTS}},data:{status:ProviderOrderStatus.PROCESSING,attempts:{increment:1},lastError:null}});if(claim.count!==1)throw new FulfillmentEngineError("CONCURRENT_OR_INVALID_EXECUTION");await tx.fulfillment.update({where:{id:fulfillment.id},data:{status:FulfillmentStatus.PROCESSING}});await tx.order.update({where:{id:orderId},data:{status:OrderStatus.PROCESSING,events:{create:{status:OrderStatus.PROCESSING,note:retry?"Retry manual de provider iniciado.":"Execução do provider iniciada."}}}});return providerOrder;});
  try{const result=await adapter.createOrder({providerProductId:selected.externalProductId,reference:prepared.id,payload:{orderId}});const outcome=providerOutcome(result.status,result.delivery);if(outcome.deliver){await prisma.$transaction([prisma.providerOrder.update({where:{id:prepared.id},data:{status:ProviderOrderStatus.COMPLETED,externalOrderId:result.externalOrderId,responseReference:result.reference}}),prisma.fulfillment.update({where:{orderId},data:{status:FulfillmentStatus.FULFILLED,delivery:result.delivery as Prisma.InputJsonValue}}),prisma.order.update({where:{id:orderId},data:{status:OrderStatus.DELIVERED,events:{create:[{status:OrderStatus.FULFILLED,note:"Provider concluído com sucesso."},{status:OrderStatus.DELIVERED,note:"Entrega disponibilizada."}]}}})]);return{status:"COMPLETED" as const};}
    if(result.status==="PROCESSING"){await prisma.providerOrder.update({where:{id:prepared.id},data:{externalOrderId:result.externalOrderId,status:ProviderOrderStatus.PROCESSING,responseReference:result.reference}});return{status:"PROCESSING" as const};}
    throw new FulfillmentEngineError(result.error??"PROVIDER_FAILED");
  }catch(cause){const message=cause instanceof Error?cause.message:"PROVIDER_FAILED";await prisma.$transaction([prisma.providerOrder.update({where:{id:prepared.id},data:{status:ProviderOrderStatus.FAILED,lastError:message}}),prisma.fulfillment.update({where:{orderId},data:{status:FulfillmentStatus.FAILED}}),prisma.order.update({where:{id:orderId},data:{status:OrderStatus.FAILED,events:{create:{status:OrderStatus.FAILED,note:`Falha no provider: ${message}`}}}})]);throw cause;}
}
