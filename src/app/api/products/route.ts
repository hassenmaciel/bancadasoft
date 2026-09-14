import { NextResponse } from "next/server";
import { ProductType } from "@prisma/client";
import { session } from "@/lib/auth";
import { findPublicCatalog, popularPublicProducts, recentPublicProducts } from "@/lib/catalog-search";
import { productDto } from "@/lib/dto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const settings = await prisma.siteSettings.findUnique({ where: { id: "default" }, select: { maintenanceEnabled: true, maintenanceMessage: true } });
  if (settings?.maintenanceEnabled) return NextResponse.json({ maintenance: true, message: settings.maintenanceMessage }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const type = params.get("type");
  if (type && !Object.values(ProductType).includes(type as ProductType)) return NextResponse.json({ error: "Tipo comercial inválido." }, { status: 422 });
  const filters = { query: params.get("q")?.slice(0, 120) || undefined, category: params.get("category") || undefined, brand: params.get("brand") || undefined, type: type as ProductType | undefined, sort: (params.get("sort") || "priority") as "priority" | "recent" | "name" };
  const viewer = await session();
  const [data, popular, recent, categories] = await Promise.all([
    findPublicCatalog(filters), popularPublicProducts(), recentPublicProducts(),
    prisma.category.findMany({ where: { active: true, products: { some: { status: "PUBLISHED", available: true } } }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
  ]);
  const map = (product: Parameters<typeof productDto>[0]) => productDto(product, viewer);
  return NextResponse.json({ data: data.map(map), popular: { source: popular.source, data: popular.products.map(map) }, recent: recent.map(map), facets: { categories } });
}
