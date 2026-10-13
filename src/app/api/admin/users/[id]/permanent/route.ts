import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  inProgressOrderWhere,
  pendingPaymentWhere,
  purgeBlockMessages,
  purgeDecision,
  purgeUser,
  type PurgeBlock,
} from "@/lib/admin-user-purge";

type Context = { params: Promise<{ id: string }> };
const bodySchema = z.object({ confirmEmail: z.string().max(254) });

class PurgeBlocked extends Error {
  constructor(readonly reason: PurgeBlock) {
    super(reason);
  }
}

// Exclusão PERMANENTE (hard delete em cascata). O DELETE de /api/admin/users/[id]
// continua sendo a exclusão "segura", que desativa quando há histórico.
export async function DELETE(request: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Digite o e-mail do usuário para confirmar." }, { status: 422 });
  const { id } = await params;
  const now = new Date();
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Checagens dentro da transação: nada muda entre validar e apagar.
        const user = await tx.user.findUnique({
          where: { id },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            customerTier: true,
            active: true,
            createdAt: true,
            accountBalance: { select: { balanceCents: true, enabled: true } },
            _count: { select: { orders: true, auditLogs: true, ledgerEntries: true, resellerApiKeys: true } },
          },
        });
        if (!user) return null;
        const [activeAdminCount, pendingPayments, ordersInProgress, paidTotal] = await Promise.all([
          tx.user.count({ where: { role: "ADMIN", active: true } }),
          tx.payment.count({ where: pendingPaymentWhere(id, now) }),
          tx.order.count({ where: inProgressOrderWhere(id) }),
          tx.payment.aggregate({ where: { order: { customerId: id }, status: "PAID" }, _sum: { amountCents: true } }),
        ]);
        const block = purgeDecision(
          {
            id: user.id,
            email: user.email,
            role: user.role,
            active: user.active,
            authoredAuditLogs: user._count.auditLogs,
            pendingPayments,
            ordersInProgress,
          },
          { confirmEmail: parsed.data.confirmEmail, actorId: admin.id, activeAdminCount },
        );
        if (block) throw new PurgeBlocked(block);
        // Auditoria ANTES de apagar, com um retrato do que vai sumir. Se a
        // exclusão falhar, a transação desfaz também este registro.
        await tx.auditLog.create({
          data: {
            actorUserId: admin.id,
            action: "USER_PERMANENTLY_DELETED",
            entityType: "User",
            entityId: user.id,
            metadata: {
              email: user.email,
              name: user.name,
              role: user.role,
              customerTier: user.customerTier,
              active: user.active,
              createdAt: user.createdAt.toISOString(),
              orders: user._count.orders,
              paidTotalCents: paidTotal._sum.amountCents ?? 0,
              ledgerEntries: user._count.ledgerEntries,
              balanceCents: user.accountBalance?.balanceCents ?? 0,
              balanceEnabled: user.accountBalance?.enabled ?? false,
              resellerApiKeys: user._count.resellerApiKeys,
            },
          },
        });
        return purgeUser(tx, user.id);
      },
      { timeout: 30_000 },
    );
    if (!result) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
    return NextResponse.json({
      data: {
        message: `Usuário excluído permanentemente (${result.orders} pedido(s), ${result.ledgerEntries} lançamento(s) de saldo).`,
        ...result,
      },
    });
  } catch (error) {
    if (error instanceof PurgeBlocked)
      return NextResponse.json(
        { error: purgeBlockMessages[error.reason], reason: error.reason },
        { status: error.reason === "CONFIRMATION_MISMATCH" ? 422 : 409 },
      );
    console.error("[admin-user-purge] Falha na exclusão permanente.", { userId: id });
    return NextResponse.json({ error: "Não foi possível excluir o usuário." }, { status: 500 });
  }
}
