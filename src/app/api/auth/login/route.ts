import { NextResponse } from "next/server";
import { z } from "zod";
import { login,setSession } from "@/lib/auth";
import { runLoginFlow } from "@/lib/login-flow";

export async function POST(request:Request){const parsed=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(8)}).safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Dados inválidos"},{status:422});const result=await runLoginFlow(parsed.data.email,parsed.data.password,{authenticate:login,createSession:setSession});if(result.status===401)return NextResponse.json({error:"Credenciais inválidas"},{status:401});if(result.status===500)return NextResponse.json({error:"Não foi possível iniciar a sessão."},{status:500});return NextResponse.json({data:result.user});}
