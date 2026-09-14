import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { productVariantInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";
import {
  calculateVariantPricing,
  loadPricingContext,
  variantPricingUpdateData,
} from "@/lib/pricing-service";
import { isProductionProviderCode } from "@/lib/providers/selection";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = productVariantInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const { id: productId } = await context.params;
  const [product, providerProduct, pricingContext] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { id: true, type: true } }),
    prisma.providerProduct.findFirst({
      where: {
        id: parsed.data.providerProductId,
        active: true,
        mode: "REAL",
        technicalEligibility: "READY",
        provider: { active: true },
        variants: { none: {} },
      },
      include: { provider: true },
    }),
    loadPricingContext(),
  ]);
  if (!product || !providerProduct || !isProductionProviderCode(providerProduct.provider.code))
    return NextResponse.json({ error: "Produto ou fornecedor indisponível para vínculo." }, { status: 422 });
  try {
    const variant = await prisma.productVariant.create({
      data: {
        productId,
        providerProductId: providerProduct.id,
        name: parsed.data.name,
        code: parsed.data.code,
        active: parsed.data.active,
        sortOrder: parsed.data.sortOrder,
        pricingMode: parsed.data.pricingMode,
        manualPriceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents : null,
        normalPriceCents: parsed.data.normalPriceCents,
        premiumPriceCents: parsed.data.premiumPriceCents,
      },
      include: { product: { select: { type: true } }, providerProduct: true },
    });
    const result = calculateVariantPricing(variant, pricingContext);
    const updated = await prisma.productVariant.update({
      where: { id: variant.id },
      data: variantPricingUpdateData(variant, result),
      include: { providerProduct: { include: { provider: true } } },
    });
    await prisma.auditLog.create({ data: { actorUserId: admin.id, action: "PRODUCT_VARIANT_CREATED", entityType: "ProductVariant", entityId: variant.id, metadata: { productId, providerProductId: providerProduct.id } } });
    return NextResponse.json({ data: updated }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Não foi possível criar a variante." }, { status: 409 });
  }
}
