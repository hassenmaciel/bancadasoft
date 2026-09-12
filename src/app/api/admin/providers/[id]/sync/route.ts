import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { syncProviderCatalog } from "@/lib/providers/catalog-sync";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await syncProviderCatalog(id, admin.id) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PROVIDER_CATALOG_SYNC_FAILED";
    if (code === "PROVIDER_NOT_FOUND") return NextResponse.json({ error: "Provider não encontrado." }, { status: 404 });
    if (code === "PROVIDER_ADAPTER_NOT_FOUND") return NextResponse.json({ error: "Sincronização não suportada para este provider." }, { status: 422 });
    return NextResponse.json({ error: "Não foi possível sincronizar o catálogo. O último snapshot foi preservado." }, { status: 502 });
  }
}
