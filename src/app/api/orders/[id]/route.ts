import { NextResponse } from "next/server";
import { getOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
import { session } from "@/lib/auth";
import { canReadOrder } from "@/lib/public-navigation";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const order = await getOrder(id); if(!order)return NextResponse.json({error:"Pedido não encontrado."},{status:404});const user=await session();const authorizedUser=Boolean(user&&canReadOrder(user,order.customerId));const token=new URL(request.url).searchParams.get("token");if(!authorizedUser&&token!==order.publicToken)return NextResponse.json({error:"Acesso não autorizado."},{status:403});return NextResponse.json({ data: orderDto(order,{includeDelivery:authorizedUser}) }); }
