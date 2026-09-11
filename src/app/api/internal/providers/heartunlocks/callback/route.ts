import { NextResponse } from "next/server";
import { z } from "zod";
import { processHeartUnlocksCallback } from "@/lib/providers/heartunlocks-callback";
const schema=z.object({reference_id:z.string().min(1).max(200),order_id:z.string().min(1).max(200),status:z.string().min(1).max(40),replay:z.string().max(20000).optional()});
export async function POST(request:Request){const expected=process.env.BANCADASOFT_INTERNAL_SECRET;const supplied=request.headers.get("x-internal-secret");if(!expected||!supplied||supplied!==expected)return NextResponse.json({error:"Não autorizado."},{status:401});const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Payload inválido."},{status:422});const result=await processHeartUnlocksCallback(parsed.data);return NextResponse.json({received:true,...result})}
