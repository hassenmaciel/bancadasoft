import { NextResponse } from "next/server";
import { getOrder, renewPixPayment } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
import { session } from "@/lib/auth";
import { canReadOrder } from "@/lib/public-navigation";
export const dynamic = "force-dynamic";

// "Gerar novo PIX": no máximo uma nova cobrança por pedido, sem novo Order/Payment.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const order = await getOrder(id);
  if (!order)
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  const user = await session();
  const authorizedUser = Boolean(user && canReadOrder(user, order.customerId));
  const token = new URL(request.url).searchParams.get("token");
  if (!authorizedUser && token !== order.publicToken)
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  try {
    const renewed = await renewPixPayment(id);
    if (!renewed) throw new Error("PIX_RENEW_UNAVAILABLE");
    return NextResponse.json({ data: orderDto(renewed, { includeDelivery: false }) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PIX_CHECKOUT_IN_PROGRESS" || code === "PIX_RENEW_NOT_ALLOWED")
      return NextResponse.json(
        { error: code === "PIX_RENEW_NOT_ALLOWED" ? "Este pedido não permite gerar novo PIX." : "Já estamos gerando o seu PIX. Aguarde alguns segundos.", code },
        { status: 409 },
      );
    return NextResponse.json({ error: "Não foi possível gerar um novo PIX agora." }, { status: 500 });
  }
}
