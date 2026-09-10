import { NextResponse } from "next/server";
import { z } from "zod";
import { login, setSession } from "@/lib/auth";
export async function POST(request:Request){const p=z.object({email:z.string().email(),password:z.string().min(8)}).safeParse(await request.json());if(!p.success)return NextResponse.json({error:"Dados inválidos"},{status:422});const user=await login(p.data.email,p.data.password);if(!user)return NextResponse.json({error:"Credenciais inválidas"},{status:401});await setSession(user);return NextResponse.json({data:user});}
