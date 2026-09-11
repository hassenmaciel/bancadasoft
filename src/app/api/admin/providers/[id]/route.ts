import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { providerOperationAuditMetadata } from "@/lib/admin-provider-operation";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof (body as { active?: unknown }).active !== "boolean") {
    return NextResponse.json({ error: "O estado operacional deve ser informado." }, { status: 422 });
  }

  const { id } = await context.params;
  const requestedActive = (body as { active: boolean }).active;
  try {
    const provider = await prisma.$transaction(async (tx) => {
      const current = await tx.provider.findUnique({
        where: { id },
        select: { id: true, code: true, name: true, active: true, integrationStatus: true },
      });
      if (!current) return null;
      if (current.active === requestedActive) return current;

      const updated = await tx.provider.update({
        where: { id },
        data: { active: requestedActive },
        select: { id: true, code: true, name: true, active: true, integrationStatus: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: admin.id,
          action: requestedActive ? "PROVIDER_OPERATION_ACTIVATED" : "PROVIDER_OPERATION_DEACTIVATED",
          entityType: "Provider",
          entityId: current.id,
          metadata: providerOperationAuditMetadata(current.active, requestedActive),
        },
      });
      return updated;
    });
    if (!provider) return NextResponse.json({ error: "Provider não encontrado." }, { status: 404 });
    return NextResponse.json({ data: provider });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar a operação do provider." }, { status: 500 });
  }
}
