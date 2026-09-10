import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { executeFulfillment, FulfillmentEngineError } from "@/lib/fulfillment-engine";

type Context={params:Promise<{id:string}>};
export async function POST(_:Request,context:Context){try{await requireAdmin();}catch{return NextResponse.json({error:"Não autorizado."},{status:403});}const{id}=await context.params;try{const result=await executeFulfillment(id,{retry:true});return NextResponse.json({data:result});}catch(error){const message=error instanceof FulfillmentEngineError?error.code:"Falha ao executar retry.";return NextResponse.json({error:message},{status:409});}}
