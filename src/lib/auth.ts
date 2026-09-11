import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { UserSessionDTO } from "@/lib/dto";
import { assertAdminRole } from "@/lib/authorization";
import { verifyPassword } from "@/lib/password";
const key = new TextEncoder().encode(process.env.AUTH_SECRET);
const name = "bancadasoft_session";
export async function login(email: string, password: string): Promise<UserSessionDTO | null> { const user = await prisma.user.findUnique({ where:{email:email.trim().toLowerCase()} }); if (!user || !await verifyPassword(password,user.passwordHash)) return null; return {id:user.id,email:user.email,name:user.name,role:user.role}; }
export async function setSession(user: UserSessionDTO) { const token = await new SignJWT(user).setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(key); (await cookies()).set(name,token,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:604800}); }
export async function session(): Promise<UserSessionDTO | null> { const token=(await cookies()).get(name)?.value; if(!token) return null; try{return (await jwtVerify(token,key)).payload as unknown as UserSessionDTO;}catch{return null;} }
export async function requireUser() { const user=await session(); if(!user) throw new Error("UNAUTHORIZED"); return user; }
export async function requireAdmin() { const user=await requireUser(); assertAdminRole(user.role); return user; }
export async function logout(){(await cookies()).delete(name);}
