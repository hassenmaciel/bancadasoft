import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminUserUpdateSchema } from "@/lib/admin-inputs";
import { canChangeLastAdmin, userDeleteDecision } from "@/lib/admin-rules";
import { prisma } from "@/lib/prisma";
import { audit, safeChangeMetadata } from "@/lib/audit";
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
      select: { id: true, name: true, role: true, customerTier: true, active: true },
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
  const user = await prisma.user.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      customerTier: true,
      active: true,
      createdAt: true,
    },
  });
  await audit(
    admin.id,
    "USER_UPDATED",
    "User",
    id,
    safeChangeMetadata(current, user),
  );
  return NextResponse.json({ data: user });
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
        _count: { select: { orders: true, auditLogs: true } },
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
      orders: current._count.orders + current._count.auditLogs,
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
