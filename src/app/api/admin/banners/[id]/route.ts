import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exceedsActiveLimit, homeBannerInputSchema, MAX_ACTIVE_HOME_BANNERS } from "@/lib/home-banner";
import { removeAdminAsset } from "@/lib/admin-storage";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = homeBannerInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.homeBanner.findUnique({ where: { id } });
    if (!previous) return { error: "NOT_FOUND" as const };
    if (exceedsActiveLimit(await tx.homeBanner.count({ where: { active: true, id: { not: id } } }), parsed.data.active))
      return { error: "LIMIT" as const };
    const banner = await tx.homeBanner.update({ where: { id }, data: parsed.data });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: "HOME_BANNER_UPDATED",
        entityType: "HomeBanner",
        entityId: id,
        metadata: { title: banner.title, active: banner.active, sortOrder: banner.sortOrder, imageChanged: previous.imageUrl !== banner.imageUrl },
      },
    });
    return { banner, previous };
  });
  if ("error" in result)
    return result.error === "NOT_FOUND"
      ? NextResponse.json({ error: "Banner não encontrado." }, { status: 404 })
      : NextResponse.json({ error: `Já existem ${MAX_ACTIVE_HOME_BANNERS} banners ativos. Desative um antes.` }, { status: 409 });
  if (result.previous.imageUrl !== result.banner.imageUrl) await removeAdminAsset(result.previous.imageUrl).catch(() => false);
  return NextResponse.json({ data: result.banner });
}

export async function DELETE(_: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await params;
  const banner = await prisma.homeBanner.findUnique({ where: { id } });
  if (!banner) return NextResponse.json({ error: "Banner não encontrado." }, { status: 404 });
  await prisma.$transaction([
    prisma.homeBanner.delete({ where: { id } }),
    prisma.auditLog.create({
      data: { actorUserId: admin.id, action: "HOME_BANNER_DELETED", entityType: "HomeBanner", entityId: id, metadata: { title: banner.title } },
    }),
  ]);
  await removeAdminAsset(banner.imageUrl).catch(() => false);
  return NextResponse.json({ data: { message: "Banner excluído." } });
}
