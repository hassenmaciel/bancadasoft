import { NextResponse } from "next/server";
import { processPayment } from "@/lib/commerce";
import { getPaymentProvider } from "@/lib/payments/registry";
export async function POST(request: Request) { const provider=getPaymentProvider("mock");const body:unknown=await request.json();if(!provider?.validateWebhook(body))return NextResponse.json({error:"Evento inválido."},{status:400});const result=await processPayment(provider.parseWebhook(body));if(!result)return NextResponse.json({error:"Pedido não encontrado."},{status:404});return NextResponse.json({data:{duplicate:result.duplicate,order:result.order}});}
