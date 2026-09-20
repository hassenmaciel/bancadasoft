import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { removeAdminAsset, uploadAdminAsset } from "@/lib/admin-storage";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { isAssetReferenced } from "@/lib/asset-references";
export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const form = await request.formData();
  const file = form.get("file"),
    kind = form.get("kind");
  if (!(file instanceof File) || (kind !== "products" && kind !== "brands" && kind !== "banners"))
    return NextResponse.json({ error: "Arquivo inválido." }, { status: 422 });
  try {
    const asset = await uploadAdminAsset({ file, kind });
    await audit(admin.id, "ASSET_UPLOADED", "Asset", undefined, {
      kind,
      path: asset.path,
    });
    return NextResponse.json({ data: { url: asset.url } });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "STORAGE_UPLOAD_FAILED";
    return NextResponse.json(
      {
        error:
          code === "STORAGE_NOT_CONFIGURED"
            ? "Storage não configurado."
            : code.startsWith("Use ") || code.startsWith("A imagem")
              ? code
              : "Não foi possível enviar a imagem.",
      },
      { status: code === "STORAGE_NOT_CONFIGURED" ? 503 : 422 },
    );
  }
}
export async function DELETE(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const url = (await request.json().catch(() => null))?.url;
  if (typeof url !== "string")
    return NextResponse.json({ error: "Imagem inválida." }, { status: 422 });
  try {
    // Defesa no servidor: nunca apagar arquivo em uso, mesmo que o cliente peça.
    if (await isAssetReferenced(url, prisma))
      return NextResponse.json(
        { error: "Esta imagem está em uso e não pode ser removida." },
        { status: 409 },
      );
    const removed = await removeAdminAsset(url);
    if (removed)
      await audit(admin.id, "ASSET_REMOVED", "Asset", undefined, {
        storageAsset: true,
      });
    return NextResponse.json({ data: { removed } });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível remover a imagem." },
      { status: 422 },
    );
  }
}
