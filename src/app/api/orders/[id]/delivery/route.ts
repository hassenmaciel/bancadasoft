import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {DELIVERY_RATE_LIMIT,DELIVERY_RATE_WINDOW_MS,deliveryAccessFingerprint,deliveryTokenMatches} from "@/lib/guest-delivery";
import {customerDelivery} from "@/lib/customer-delivery";
import {attemptAutomaticGuestRecovery} from "@/lib/fulfillment-engine";
import {isUnlockToolLicense} from "@/lib/unlocktool-license";
export const dynamic="force-dynamic";
const orderSelect={id:true,publicToken:true,status:true,createdAt:true,deliveryTokenHash:true,deliveryTokenExpiresAt:true,deliveryTokenRevokedAt:true,items:{select:{product:{select:{name:true,type:true,brand:{select:{name:true}}}}}},payment:{select:{status:true}},fulfillment:{select:{status:true,delivery:true}}} as const;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const{id}=await params;const authorization=request.headers.get("authorization")??"";const token=authorization.startsWith("Bearer ")?authorization.slice(7):"";
  const fingerprint=deliveryAccessFingerprint(request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown");
  const recent=await prisma.deliveryAccessAttempt.count({where:{orderId:id,fingerprint,successful:false,createdAt:{gte:new Date(Date.now()-DELIVERY_RATE_WINDOW_MS)}}});
  if(recent>=DELIVERY_RATE_LIMIT)return NextResponse.json({error:"Muitas tentativas. Tente novamente mais tarde."},{status:429});
  let order=await prisma.order.findUnique({where:{id},select:orderSelect});
  if(!order||!deliveryTokenMatches(token,order.deliveryTokenHash,order.deliveryTokenExpiresAt,order.deliveryTokenRevokedAt)){
    if(order)await prisma.deliveryAccessAttempt.create({data:{orderId:id,fingerprint}});
    return NextResponse.json({error:"Acesso não autorizado."},{status:403});
  }
  // Mesmo recovery/reconciliação automático, throttlado e idempotente, usado
  // pelo endpoint de status (ver src/app/api/orders/[id]/route.ts) — esta
  // página (/acompanhar, o backup por e-mail) também é consultada em
  // intervalo curto e não pode depender só do Admin para convergir.
  if(order.payment?.status==="PAID"&&order.status!=="DELIVERED"){
    const attempted=await attemptAutomaticGuestRecovery(id).catch(()=>false);
    if(attempted)order=(await prisma.order.findUnique({where:{id},select:orderSelect}))??order;
  }
  const delivery=order.status==="DELIVERED"?customerDelivery(order.fulfillment?.delivery):null;
  return NextResponse.json({data:{id:order.id,number:order.publicToken.slice(0,8).toUpperCase(),status:order.status,createdAt:order.createdAt,products:order.items.map(item=>item.product.name),...(isUnlockToolLicense(order.items[0]?.product)?{licenseActivation:true}:{}),paymentStatus:order.payment?.status??null,fulfillmentStatus:order.fulfillment?.status??null,delivery}});
}
