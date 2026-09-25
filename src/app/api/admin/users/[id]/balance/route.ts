import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { balanceToggleSchema, setAccountBalanceEnabled } from "@/lib/reseller-admin";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  let admin;
  try { admin = await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = balanceToggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { id } = await params;
  const result = await setAccountBalanceEnabled(prisma, id, parsed.data.enabled);
  if (!result.ok) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  await audit(admin.id, "USER_BALANCE_TOGGLED", "User", id, { enabled: result.balance.enabled });
  return NextResponse.json({ data: result.balance });
}
