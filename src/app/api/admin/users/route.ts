import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminUserInputSchema } from "@/lib/admin-inputs";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  let admin;
  try { admin = await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = adminUserInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Informe nome, e-mail válido e senha forte com 12+ caracteres, maiúscula, minúscula, número e símbolo." }, { status: 422 });
  try {
    const user = await prisma.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password), role: parsed.data.role, customerTier: parsed.data.customerTier },
      select: { id: true, name: true, email: true, role: true, customerTier: true, active: true, createdAt: true },
    });
    await audit(admin.id, "USER_CREATED", "User", user.id, { email: user.email, role: user.role, customerTier: user.customerTier });
    return NextResponse.json({ data: user }, { status: 201 });
  } catch { return NextResponse.json({ error: "E-mail já cadastrado." }, { status: 409 }); }
}
