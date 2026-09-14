import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { setSession } from "@/lib/auth";
import { registrationSchema } from "@/lib/registration";

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe nome, e-mail válido e senha forte." }, { status: 422 });
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, passwordHash: true } });
  if (existing) return NextResponse.json({ error: "E-mail já cadastrado. Use a opção de entrar." }, { status: 409 });
  const user = await prisma.user.create({ data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password), role: "USER", customerTier: "NORMAL" }, select: { id: true, email: true, name: true, role: true, customerTier: true } });
  await setSession(user);
  return NextResponse.json({ ok: true }, { status: 201 });
}
