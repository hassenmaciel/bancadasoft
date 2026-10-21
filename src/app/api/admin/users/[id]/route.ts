import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/auth";
import { adminUserUpdateSchema } from "@/lib/admin-inputs";
import { canChangeLastAdmin, userDeleteDecision } from "@/lib/admin-rules";
import { prisma } from "@/lib/prisma";
import { audit, safeChangeMetadata } from "@/lib/audit";
import { setAccountBalanceEnabled } from "@/lib/reseller-admin";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = adminUserUpdateSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { id } = await params,
    current = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, customerTier: true, canUseBalanceAsPayment: true, balanceTopupBlocked: true, active: true },
    });
  if (!current)
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 },
    );
  const nextRole = parsed.data.role ?? current.role,
    nextActive = parsed.data.active ?? current.active,
    adminCount = await prisma.user.count({
      where: { role: "ADMIN", active: true },
    });
  if (id === admin.id && !nextActive)
    return NextResponse.json(
      { error: "Você não pode desativar sua própria conta." },
      { status: 409 },
    );
  if (
    !canChangeLastAdmin(
      adminCount,
      current.role,
      nextActive ? nextRole : "USER",
    )
  )
    return NextResponse.json(
      { error: "O último administrador ativo deve ser preservado." },
      { status: 409 },
    );
  // Promoção a PREMIUM_PLUS: habilita o saldo e grava o uso de saldo como
  // pagamento na mesma transação (mesma regra da promoção por recarga).
  const promotedToPremiumPlus =
    parsed.data.customerTier === "PREMIUM_PLUS" && current.customerTier !== "PREMIUM_PLUS";
  // Rebaixamento não mexe em saldo nem em canUseBalanceAsPayment: o cliente
  // continua gastando o que sobrou. O painel oferece ligar balanceTopupBlocked
  // na mesma requisição para a próxima recarga não promover de volta.
  const demotedFromPremiumPlus =
    current.customerTier === "PREMIUM_PLUS" && parsed.data.customerTier !== undefined && parsed.data.customerTier !== "PREMIUM_PLUS";
  const topupBlockChanged =
    parsed.data.balanceTopupBlocked !== undefined && parsed.data.balanceTopupBlocked !== current.balanceTopupBlocked;
  if (parsed.data.email && parsed.data.email !== current.email) {
    const taken = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
    if (taken) return NextResponse.json({ error: "E-mail já cadastrado em outra conta." }, { status: 409 });
  }
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: promotedToPremiumPlus ? { ...parsed.data, canUseBalanceAsPayment: true } : parsed.data,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          customerTier: true,
          canUseBalanceAsPayment: true,
          balanceTopupBlocked: true,
          active: true,
          createdAt: true,
        },
      });
      if (promotedToPremiumPlus) await setAccountBalanceEnabled(tx, id, true);
      return updated;
    });
  } catch (error) {
    // Corrida com outro cadastro usando o mesmo e-mail (unique de User.email).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "E-mail já cadastrado em outra conta." }, { status: 409 });
    throw error;
  }
  await audit(
    admin.id,
    "USER_UPDATED",
    "User",
    id,
    safeChangeMetadata(current, user),
  );
  if (promotedToPremiumPlus)
    await audit(admin.id, "USER_BALANCE_TOGGLED", "User", id, { enabled: true, reason: "PREMIUM_PLUS" });
  if (topupBlockChanged)
    await audit(admin.id, "USER_TOPUP_BLOCK_TOGGLED", "User", id, {
      blocked: user.balanceTopupBlocked,
      ...(demotedFromPremiumPlus ? { reason: "DEMOTED_FROM_PREMIUM_PLUS" } : {}),
    });
  return NextResponse.json({ data: user, balanceEnabled: promotedToPremiumPlus, demotedFromPremiumPlus });
}
export async function DELETE(_: Request, { params }: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const { id } = await params,
    current = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        role: true,
        _count: { select: { orders: true, auditLogs: true, ledgerEntries: true, resellerApiKeys: true } },
        accountBalance: { select: { id: true } },
      },
    });
  if (!current)
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 },
    );
  const adminCount = await prisma.user.count({
    where: { role: "ADMIN", active: true },
  }),
    decision = userDeleteDecision({
      self: id === admin.id,
      adminCount,
      role: current.role,
      // Saldo, ledger e chaves de revenda também são histórico (FK RESTRICT):
      // com qualquer um deles o usuário é desativado, nunca excluído.
      orders:
        current._count.orders +
        current._count.auditLogs +
        current._count.ledgerEntries +
        current._count.resellerApiKeys +
        (current.accountBalance ? 1 : 0),
    });
  if (decision === "BLOCK")
    return NextResponse.json(
      {
        error:
          id === admin.id
            ? "Você não pode excluir sua própria conta."
            : "O último administrador ativo deve ser preservado.",
      },
      { status: 409 },
    );
  await prisma.$transaction(async (tx) => {
    if (decision === "DELETE") await tx.user.delete({ where: { id } });
    else await tx.user.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        action: decision === "DELETE" ? "USER_DELETED" : "USER_DISABLED",
        entityType: "User",
        entityId: id,
        metadata: { name: current.name, orders: current._count.orders, auditLogs: current._count.auditLogs },
      },
    });
  });
  return NextResponse.json({
    data: {
      action: decision,
      message:
        decision === "ARCHIVE"
          ? "Usuário desativado para preservar o histórico."
          : "Usuário excluído.",
    },
  });
}