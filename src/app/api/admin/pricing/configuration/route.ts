import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { pricingConfigurationSchema } from "@/lib/pricing-admin";
import { prisma } from "@/lib/prisma";
import { recalculateProducts } from "@/lib/pricing-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try { await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const data = await prisma.pricingConfiguration.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
    include: { groupRules: { orderBy: { productType: "asc" } } },
  });
  return NextResponse.json({ data });
}

export async function PUT(request: Request) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = pricingConfigurationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Configuração inválida." }, { status: 422 });
  const { groupRules, ...global } = parsed.data;
  const data = await prisma.$transaction(async (tx) => {
    const config = await tx.pricingConfiguration.upsert({
      where: { id: "default" },
      update: global,
      create: { id: "default", ...global },
    });
    await tx.pricingGroupRule.deleteMany({ where: { configurationId: "default" } });
    if (groupRules.length) await tx.pricingGroupRule.createMany({ data: groupRules.map((rule) => ({ ...rule, configurationId: "default" })) });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: "PRICING_CONFIGURATION_UPDATED",
        entityType: "PricingConfiguration",
        entityId: "default",
        metadata: { automaticEnabled: config.automaticEnabled, groupRules: groupRules.map((rule) => rule.productType) },
      },
    });
    return config;
  });
  const autoProducts = await prisma.product.findMany({ where: { pricingMode: { not: "MANUAL" } }, select: { id: true } });
  await recalculateProducts(autoProducts.map(({ id }) => id));
  return NextResponse.json({ data: { ...data, groupRules } });
}
