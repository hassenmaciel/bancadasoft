import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { categoryInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const categories = await prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } });
  return NextResponse.json({ data: categories });
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = categoryInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  try {
    return NextResponse.json({ data: await prisma.category.create({ data: parsed.data }) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Nome ou slug já cadastrado." }, { status: 409 });
  }
}
