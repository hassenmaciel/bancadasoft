import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listAdminIntegrations } from "@/lib/admin-integrations";

export const dynamic = "force-dynamic";
export async function GET() {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  return NextResponse.json({ data: await listAdminIntegrations() });
}
