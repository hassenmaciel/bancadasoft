import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { calculateProductPricing, loadPricingContext, pricingUpdateData } from "@/lib/pricing-service";

const include = { category: true, brand: true, providerProducts: { include: { provider: true } } } as const;

export async function GET() {
  try { await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const [products, context] = await Promise.all([
    prisma.product.findMany({ include, orderBy: { updatedAt: "desc" } }),
    loadPricingContext(),
  ]);
  return NextResponse.json({ data: products.map((product) => adminProductDto(product, calculateProductPricing(product, context))) });
}

export async function POST(request: Request) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = productInputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const category = await prisma.category.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } });
  if (!category) return NextResponse.json({ error: "Categoria não encontrada." }, { status: 422 });
  const context = await loadPricingContext();
  try {
    const input = {
      ...parsed.data,
      manualPriceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents : null,
      priceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents! : parsed.data.priceCents,
    };
    const created = await prisma.product.create({ data: input, include });
    const pricing = calculateProductPricing(created, context);
    const product = await prisma.product.update({ where: { id: created.id }, data: pricingUpdateData(created, pricing), include });
    await audit(admin.id, "PRODUCT_CREATED", "Product", product.id, { name: product.name, status: product.status, priceCents: product.priceCents, pricingMode: product.pricingMode });
    return NextResponse.json({ data: adminProductDto(product, calculateProductPricing(product, context)) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível criar o produto. Verifique o slug." }, { status: 409 });
  }
}
