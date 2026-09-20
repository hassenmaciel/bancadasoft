import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { exceedsActiveLimit, homeBannerInputSchema, MAX_ACTIVE_HOME_BANNERS } from "@/lib/home-banner";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  return NextResponse.json({ data: await prisma.homeBanner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }) });
}

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = homeBannerInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 422 });
  const banner = await prisma.$transaction(async (tx) => {
    if (exceedsActiveLimit(await tx.homeBanner.count({ where: { active: true } }), parsed.data.active)) return null;
    const created = await tx.homeBanner.create({ data: parsed.data });
    await tx.auditLog.create({
      data: { actorUserId: admin.id, action: "HOME_BANNER_CREATED", entityType: "HomeBanner", entityId: created.id, metadata: { title: created.title, active: created.active } },
    });
    return created;
  });
  if (!banner) return NextResponse.json({ error: `Já existem ${MAX_ACTIVE_HOME_BANNERS} banners ativos. Desative um antes.` }, { status: 409 });
  return NextResponse.json({ data: banner }, { status: 201 });
}
