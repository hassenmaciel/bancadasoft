import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { brandInputSchema } from "@/lib/admin-inputs";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { relatedEntityDeleteDecision } from "@/lib/admin-rules";
import { removeAdminAsset } from "@/lib/admin-storage";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = brandInputSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { id } = await params,
    previous = await prisma.brand.findUnique({ where: { id } });
  if (!previous)
    return NextResponse.json(
      { error: "Marca não encontrada." },
      { status: 404 },
    );
  try {
    const brand = await prisma.brand.update({
      where: { id },
      data: parsed.data,
    });
    await audit(admin.id, "BRAND_UPDATED", "Brand", id, {
      name: brand.name,
      active: brand.active,
      imageChanged: previous.imageUrl !== brand.imageUrl,
    });
    if (previous.imageUrl && previous.imageUrl !== brand.imageUrl)
      await removeAdminAsset(previous.imageUrl).catch(() => false);
    return NextResponse.json({ data: brand });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível atualizar a marca." },
      { status: 409 },
    );
  }
}
export async function DELETE(_: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await params,
    brand = await prisma.brand.findUnique({
      where: { id },
      select: {
        name: true,
        imageUrl: true,
        _count: { select: { products: true } },
      },
    });
  if (!brand)
    return NextResponse.json(
      { error: "Marca não encontrada." },
      { status: 404 },
    );
  const decision = relatedEntityDeleteDecision(brand._count.products);
  await prisma.$transaction(async (tx) => {
    if (decision === "DELETE") await tx.brand.delete({ where: { id } });
    else await tx.brand.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: decision === "DELETE" ? "BRAND_DELETED" : "BRAND_DISABLED",
        entityType: "Brand",
        entityId: id,
        metadata: { name: brand.name, products: brand._count.products },
      },
    });
  });
  if (decision === "DELETE" && brand.imageUrl)
    await removeAdminAsset(brand.imageUrl).catch(() => false);
  return NextResponse.json({
    data: {
      action: decision,
      message:
        decision === "ARCHIVE"
          ? "Marca desativada porque possui produtos associados."
          : "Marca excluída.",
    },
  });
}
