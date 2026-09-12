import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto } from "@/lib/admin-catalog";
import { bulkProductSchema, bulkStatus, isPricingBulkAction, pricingModeForBulkAction } from "@/lib/admin-product-bulk";
import { prisma } from "@/lib/prisma";
import { calculateProductPricing, loadPricingContext, recalculateProducts } from "@/lib/pricing-service";

const include = { category: true, brand: true, providerProducts: { include: { provider: true } } } as const;

export async function PATCH(request: Request) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = bulkProductSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Seleção inválida." }, { status: 422 });

  if (isPricingBulkAction(parsed.data.action)) {
    const mode = pricingModeForBulkAction(parsed.data.action);
    await prisma.$transaction(async (tx) => {
      if (mode) await tx.product.updateMany({ where: { id: { in: parsed.data.ids } }, data: { pricingMode: mode, manualPriceCents: null } });
      await tx.auditLog.create({ data: { actorUserId: admin.id, action: `PRODUCT_PRICING_BULK_${parsed.data.action}`, entityType: "Product", metadata: { ids: parsed.data.ids, explicitManualRemoval: parsed.data.action === "REMOVE_MANUAL" } } });
    });
    await recalculateProducts(parsed.data.ids);
    const [products, context] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: parsed.data.ids } }, include }),
      loadPricingContext(),
    ]);
    return NextResponse.json({ ok: true, updated: products.length, data: products.map((product) => adminProductDto(product, calculateProductPricing(product, context))) });
  }

  const status = bulkStatus(parsed.data.action);
  if (!status) return NextResponse.json({ error: "Ação inválida." }, { status: 422 });
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({ where: { id: { in: parsed.data.ids } }, data: { status } });
    await tx.auditLog.create({ data: { actorUserId: admin.id, action: `PRODUCT_BULK_${parsed.data.action}`, entityType: "Product", metadata: { count: updated.count, ids: parsed.data.ids } } });
    return updated;
  });
  return NextResponse.json({ ok: true, updated: result.count, status });
}
