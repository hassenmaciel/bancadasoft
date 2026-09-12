import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { bulkProductSchema, bulkStatus } from "@/lib/admin-product-bulk";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = bulkProductSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Seleção inválida." }, { status: 422 });
  const status = bulkStatus(parsed.data.action);
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.updateMany({ where: { id: { in: parsed.data.ids } }, data: { status } });
    await tx.auditLog.create({ data: { actorUserId: admin.id, action: `PRODUCT_BULK_${parsed.data.action}`, entityType: "Product", metadata: { count: updated.count, ids: parsed.data.ids } } });
    return updated;
  });
  return NextResponse.json({ ok: true, updated: result.count, status });
}
