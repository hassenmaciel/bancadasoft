import { NextResponse } from "next/server";
import { z } from "zod";
import { login,setSession } from "@/lib/auth";

export async function POST(request:Request){const parsed=z.object({email:z.string().trim().toLowerCase().email(),password:z.string().min(8)}).safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:"Dados inválidos"},{status:422});const user=await login(parsed.data.email,parsed.data.password);if(!user)return NextResponse.json({error:"Credenciais inválidas"},{status:401});await setSession(user);return NextResponse.json({data:user});}
