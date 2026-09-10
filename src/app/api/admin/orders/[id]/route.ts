import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAdminOrder } from "@/lib/admin-orders";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  try { await requireAdmin(); } catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const { id } = await context.params;
  const order = await getAdminOrder(id);
  return order ? NextResponse.json({ data: order }) : NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
}
