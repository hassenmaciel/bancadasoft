import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ManualDeliveryError, registerManualDelivery } from "@/lib/admin-manual-delivery";
import {
  MANUAL_DELIVERY_ERROR_MESSAGES,
  MANUAL_DELIVERY_REASON_MAX,
  MANUAL_DELIVERY_REASON_MIN,
} from "@/lib/manual-delivery-rules";

type Context = { params: Promise<{ id: string }> };

const schema = z.object({
  reason: z.string().trim().min(MANUAL_DELIVERY_REASON_MIN).max(MANUAL_DELIVERY_REASON_MAX),
});

// Registra uma entrega feita FORA do sistema (ex.: credencial comprada
// manualmente no painel do fornecedor e entregue pelo suporte). Não chama
// fornecedor, não envia e-mail e não altera o ProviderOrder — ver
// registerManualDelivery.
export async function POST(request: Request, context: Context) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: MANUAL_DELIVERY_ERROR_MESSAGES.INVALID_REASON, code: "INVALID_REASON" },
      { status: 422 },
    );
  const { id } = await context.params;
  try {
    const result = await registerManualDelivery({
      orderId: id,
      adminId: admin.id,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof ManualDeliveryError)
      return NextResponse.json(
        { error: MANUAL_DELIVERY_ERROR_MESSAGES[error.code], code: error.code },
        { status: error.code === "ORDER_NOT_FOUND" ? 404 : 409 },
      );
    console.error("[admin] manual-delivery falhou.", {
      orderId: id,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Não foi possível registrar a entrega manual.", code: "MANUAL_DELIVERY_FAILED" },
      { status: 500 },
    );
  }
}
