import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";
import { audit, safeChangeMetadata } from "@/lib/audit";
import { productDeleteDecision } from "@/lib/admin-rules";
import { removeAdminAsset } from "@/lib/admin-storage";
import { calculateProductPricing, loadPricingContext, pricingUpdateData } from "@/lib/pricing-service";
import { canPublishVariantProduct } from "@/lib/product-variants";
type Context = { params: Promise<{ id: string }> };
const include = {
  category: true,
  brand: true,
  providerProducts: { include: { provider: true } },
  variants: { include: { providerProduct: { include: { provider: true } } } },
} as const;
export async function GET(_: Request, context: Context) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await context.params,
    product = await prisma.product.findUnique({ where: { id }, include });
  const pricingContext = product ? await loadPricingContext() : null;
  return product && pricingContext
    ? NextResponse.json({ data: adminProductDto(product, calculateProductPricing(product, pricingContext)) })
    : NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
}
export async function PUT(request: Request, context: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = productInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos." },
      { status: 422 },
    );
  const { id } = await context.params,
    previous = await prisma.product.findUnique({ where: { id }, include: { variants: true } });
  if (!previous)
    return NextResponse.json(
      { error: "Produto não encontrado." },
      { status: 404 },
    );
  if (parsed.data.status === "PUBLISHED" && !canPublishVariantProduct(previous.variants))
    return NextResponse.json(
      { error: "Configure ao menos uma variante ativa, liberada e com preço antes de publicar." },
      { status: 422 },
    );
  try {
    const pricingContext = await loadPricingContext();
    const input = {
      ...parsed.data,
      manualPriceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents : null,
      priceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents! : previous.priceCents,
    };
    const intermediate = await prisma.product.update({
      where: { id },
      data: input,
      include,
    });
    const pricing = calculateProductPricing(intermediate, pricingContext);
    const product = await prisma.product.update({ where: { id }, data: pricingUpdateData(intermediate, pricing), include });
    await audit(
      admin.id,
      "PRODUCT_UPDATED",
      "Product",
      id,
      safeChangeMetadata(previous, product),
    );
    if (previous.imageUrl && previous.imageUrl !== product.imageUrl)
      await removeAdminAsset(previous.imageUrl).catch(() => false);
    return NextResponse.json({ data: adminProductDto(product, calculateProductPricing(product, pricingContext)) });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível atualizar o produto." },
      { status: 409 },
    );
  }
}
export async function DELETE(_: Request, context: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await context.params,
    product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        _count: { select: { orderItems: true, providerProducts: true } },
      },
    });
  if (!product)
    return NextResponse.json(
      { error: "Produto não encontrado." },
      { status: 404 },
    );
  const decision = productDeleteDecision(
    product._count.orderItems,
    product._count.providerProducts,
  );
  await prisma.$transaction(async (tx) => {
    if (decision === "DELETE") await tx.product.delete({ where: { id } });
    else
      await tx.product.update({
        where: { id },
        data: { status: "ARCHIVED", available: false },
      });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: decision === "DELETE" ? "PRODUCT_DELETED" : "PRODUCT_ARCHIVED",
        entityType: "Product",
        entityId: id,
        metadata: {
          name: product.name,
          reason:
            decision === "ARCHIVE" ? "HISTORY_OR_PROVIDER_LINK" : "NO_HISTORY",
        },
      },
    });
  });
  if (decision === "DELETE" && product.imageUrl)
    await removeAdminAsset(product.imageUrl).catch(() => false);
  return NextResponse.json({
    data: {
      action: decision,
      message:
        decision === "ARCHIVE"
          ? "Produto arquivado para preservar o histórico."
          : "Produto excluído com sucesso.",
    },
  });
}
