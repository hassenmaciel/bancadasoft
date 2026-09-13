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

type Context = { params: Promise<{ id: string; variantId: string }> };

export async function PUT(request: Request, context: Context) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = productVariantInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const { id: productId, variantId } = await context.params;
  const previous = await prisma.productVariant.findFirst({ where: { id: variantId, productId } });
  if (!previous) return NextResponse.json({ error: "Variante não encontrada." }, { status: 404 });
  const providerProduct = await prisma.providerProduct.findFirst({
    where: {
      id: parsed.data.providerProductId,
      active: true,
      mode: "REAL",
      technicalEligibility: "READY",
      provider: { active: true },
      variants: { none: { id: { not: variantId } } },
    },
    include: { provider: true },
  });
  if (!providerProduct || !isProductionProviderCode(providerProduct.provider.code))
    return NextResponse.json({ error: "Fornecedor indisponível para vínculo." }, { status: 422 });
  const intermediate = await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      providerProductId: providerProduct.id,
      name: parsed.data.name,
      code: parsed.data.code,
      active: parsed.data.active,
      sortOrder: parsed.data.sortOrder,
      pricingMode: parsed.data.pricingMode,
      manualPriceCents: parsed.data.pricingMode === "MANUAL" ? parsed.data.manualPriceCents : null,
    },
    include: { product: { select: { type: true } }, providerProduct: true },
  });
  const pricingContext = await loadPricingContext();
  const pricing = calculateVariantPricing(intermediate, pricingContext);
  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: variantPricingUpdateData(intermediate, pricing),
    include: { providerProduct: { include: { provider: true } } },
  });
  await prisma.auditLog.create({ data: { actorUserId: admin.id, action: "PRODUCT_VARIANT_UPDATED", entityType: "ProductVariant", entityId: variantId, metadata: { productId, providerProductId: providerProduct.id, active: updated.active, pricingMode: updated.pricingMode } } });
  return NextResponse.json({ data: updated });
}
