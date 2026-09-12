import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { simulateProviderProductPricing } from "@/lib/pricing-service";

export const dynamic = "force-dynamic";

export async function POST() {
  try { await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  return NextResponse.json({ data: await simulateProviderProductPricing() });
}
