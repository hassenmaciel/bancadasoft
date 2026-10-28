import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { whatsappLink } from "@/lib/whatsapp-link";

type Context = { params: Promise<{ id: string }> };

// Ficha de contato do usuário para o Admin. POST (não GET) porque cada consulta
// expõe dado pessoal e grava auditoria; o metadata não leva número nem CPF.
export async function POST(_request: Request, { params }: Context) {
  let admin;
  try { admin = await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      whatsapp: true,
      cpfCnpj: true,
      createdAt: true,
      _count: { select: { orders: true } },
      orders: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
      accountBalance: { select: { enabled: true, balanceCents: true } },
    },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  await audit(admin.id, "USER_CONTACT_VIEWED", "User", id);
  return NextResponse.json({
    data: {
      whatsappLink: whatsappLink(user.whatsapp),
      cpfCnpj: user.cpfCnpj,
      createdAt: user.createdAt.toISOString(),
      orderCount: user._count.orders,
      lastOrderAt: user.orders[0]?.createdAt.toISOString() ?? null,
      balance: user.accountBalance,
    },
  });
}
