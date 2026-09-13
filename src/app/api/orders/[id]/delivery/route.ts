import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {DELIVERY_RATE_LIMIT,DELIVERY_RATE_WINDOW_MS,deliveryAccessFingerprint,deliveryTokenMatches} from "@/lib/guest-delivery";
import {customerDelivery} from "@/lib/customer-delivery";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const{id}=await params;const authorization=request.headers.get("authorization")??"";const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  const fingerprint=deliveryAccessFingerprint(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown");
  const recent=await prisma.deliveryAccessAttempt.count({where:{orderId:id,fingerprint,successful:false,createdAt:{gte:new Date(Date.now()-DELIVERY_RATE_WINDOW_MS)}}});
  if(recent>=DELIVERY_RATE_LIMIT)return NextResponse.json({error:"Muitas tentativas. Tente novamente mais tarde."},{status:429});
  const order=await prisma.order.findUnique({where:{id},select:{id:true,publicToken:true,status:true,createdAt:true,deliveryTokenHash:true,deliveryTokenExpiresAt:true,deliveryTokenRevokedAt:true,items:{select:{product:{select:{name:true}}}},payment:{select:{status:true}},fulfillment:{select:{status:true,delivery:true}}}});
  if(!order||!deliveryTokenMatches(token,order.deliveryTokenHash,order.deliveryTokenExpiresAt,order.deliveryTokenRevokedAt)){
    if(order)await prisma.deliveryAccessAttempt.create({data:{orderId:id,fingerprint}});
    return NextResponse.json({error:"Acesso não autorizado."},{status:403});
  }
  const delivery=order.status==="DELIVERED"?customerDelivery(order.fulfillment?.delivery):null;
  return NextResponse.json({data:{id:order.id,number:order.publicToken.slice(0,8).toUpperCase(),status:order.status,createdAt:order.createdAt,products:order.items.map(item=>item.product.name),paymentStatus:order.payment?.status??null,fulfillmentStatus:order.fulfillment?.status??null,delivery}});
}
