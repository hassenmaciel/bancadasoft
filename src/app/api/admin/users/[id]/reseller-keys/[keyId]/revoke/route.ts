import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { revokeResellerKey } from "@/lib/reseller-admin";

type Context = { params: Promise<{ id: string; keyId: string }> };

export async function POST(_: Request, { params }: Context) {
  let admin;
  try { admin = await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const { id, keyId } = await params;
  const result = await revokeResellerKey(prisma, id, keyId);
  if (!result.ok) return NextResponse.json({ error: "Chave não encontrada." }, { status: 404 });
  if (!result.alreadyRevoked) await audit(admin.id, "RESELLER_KEY_REVOKED", "ResellerApiKey", keyId, { userId: id });
  return NextResponse.json({ data: { revoked: true } });
}
