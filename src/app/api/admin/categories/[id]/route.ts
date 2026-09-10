import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { categoryInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = categoryInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const { id } = await context.params;
  try {
    return NextResponse.json({ data: await prisma.category.update({ where: { id }, data: parsed.data }) });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar a categoria." }, { status: 409 });
  }
}
