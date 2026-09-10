import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const products = await prisma.product.findMany({ include: { category: true }, orderBy: { updatedAt: "desc" } });
    return NextResponse.json({ data: products.map(adminProductDto) });
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = productInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } });
  if (!category) return NextResponse.json({ error: "Categoria não encontrada." }, { status: 422 });
  try {
    const product = await prisma.product.create({ data: parsed.data, include: { category: true } });
    return NextResponse.json({ data: adminProductDto(product) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível criar o produto. Verifique se o slug já existe." }, { status: 409 });
  }
}
