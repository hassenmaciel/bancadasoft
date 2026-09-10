import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const { id } = await context.params;
  const product = await prisma.product.findUnique({ where: { id }, include: { category: true } });
  return product ? NextResponse.json({ data: adminProductDto(product) }) : NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = productInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } });
  if (!category) return NextResponse.json({ error: "Categoria não encontrada." }, { status: 422 });
  const { id } = await context.params;
  try {
    const product = await prisma.product.update({ where: { id }, data: parsed.data, include: { category: true } });
    return NextResponse.json({ data: adminProductDto(product) });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar o produto. Verifique o ID e o slug." }, { status: 409 });
  }
}
