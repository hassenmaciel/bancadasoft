import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { issueKeySchema, issueResellerKey } from "@/lib/reseller-admin";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  let admin;
  try { admin = await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = issueKeySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { id } = await params;
  const result = await issueResellerKey(prisma, id, parsed.data.label);
  if (!result.ok)
    return result.code === "USER_NOT_FOUND"
      ? NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 })
      : NextResponse.json({ error: "Chaves só podem ser emitidas para contas RESELLER ativas." }, { status: 409 });
  // A chave em texto puro nunca vai para o log de auditoria.
  await audit(admin.id, "RESELLER_KEY_ISSUED", "ResellerApiKey", result.key.id, { userId: id, label: result.key.label });
  return NextResponse.json({ data: { ...result.key, key: result.plaintext } }, { status: 201, headers: { "cache-control": "no-store" } });
}
