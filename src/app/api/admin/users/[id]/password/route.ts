import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { strongPasswordSchema } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({ password: strongPasswordSchema });

// Redefinição manual pelo Admin. Derruba as sessões abertas do usuário
// (passwordChangedAt) e anula links de redefinição pendentes. A senha nunca
// vai para a auditoria.
export async function PUT(request: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "A senha precisa ter 12+ caracteres, com maiúscula, minúscula, número e símbolo." },
      { status: 422 },
    );
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.passwordResetToken.deleteMany({ where: { userId: id } });
    await audit(admin.id, "USER_PASSWORD_RESET_BY_ADMIN", "User", id, { sessionsRevoked: true }, tx);
  });
  return NextResponse.json({
    data: {
      message:
        id === admin.id
          ? "Senha redefinida. Sua sessão foi encerrada; entre novamente."
          : "Senha redefinida. As sessões abertas do usuário foram encerradas.",
    },
  });
}
