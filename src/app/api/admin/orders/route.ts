import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { searchAdminOrders } from "@/lib/admin-orders";

export const dynamic = "force-dynamic";

// Retorna sempre o DTO seguro de listagem (sem CPF completo/credenciais —
// PARTE 8/16), com ou sem filtros: usado tanto na carga inicial quanto na
// busca do Admin > Pedidos.
export async function GET(request: Request) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const params = new URL(request.url).searchParams;
  const data = await searchAdminOrders({
    q: params.get("q") ?? undefined,
    orderStatus: params.get("orderStatus") ?? undefined,
    paymentStatus: params.get("paymentStatus") ?? undefined,
    fulfillmentStatus: params.get("fulfillmentStatus") ?? undefined,
    attention: params.get("attention") ?? undefined,
  });
  return NextResponse.json({ data });
}
