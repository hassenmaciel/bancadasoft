import { NextResponse } from "next/server";
import { getOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
import { session } from "@/lib/auth";
import { canReadOrder } from "@/lib/public-navigation";
import { cancelPixByCustomer } from "@/lib/payment-expiry";
export const dynamic = "force-dynamic";

// "Cancelar e começar de novo": força a expiração do PIX pendente pelo fluxo
// existente. Mesma autorização do POST /api/orders/[id]/pix (sessão dona/admin
// ou publicToken). Nunca cria Order/Payment.
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
    const outcome = await cancelPixByCustomer(id);
    if (outcome === "NOT_PENDING")
      return NextResponse.json(
        { error: "Este pedido não permite cancelar o PIX.", code: "PIX_CANCEL_NOT_ALLOWED" },
        { status: 409 },
      );
    const current = (await getOrder(id)) ?? order;
    return NextResponse.json({
      data: orderDto(current, { includeDelivery: false }),
      manualReview: outcome === "MANUAL_REVIEW",
    });
  } catch {
    return NextResponse.json({ error: "Não foi possível cancelar o PIX agora." }, { status: 500 });
  }
}
