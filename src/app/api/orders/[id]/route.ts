import { NextResponse } from "next/server";
import { getOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
import { session } from "@/lib/auth";
import { canReadOrder } from "@/lib/public-navigation";
import { expirePixIfDue } from "@/lib/payment-expiry";
import { attemptAutomaticGuestRecovery } from "@/lib/fulfillment-engine";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let order = await getOrder(id);
  if (!order)
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  const user = await session();
  const authorizedUser = Boolean(user && canReadOrder(user, order.customerId));
  const token = new URL(request.url).searchParams.get("token");
  if (!authorizedUser && token !== order.publicToken)
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  // Recovery/reconciliação automática, controlada e idempotente: só é
  // tentada quando o pagamento está confirmado e o pedido ainda não tem
  // entrega — nunca cria PIX/Order/Payment, e é throttlada internamente
  // (ver AUTO_RECOVERY_THROTTLE_MS) para não virar uma chamada ao provider a
  // cada poll de 3s do cliente.
  // Expiração do PIX pelo relógio do servidor (idempotente, cancelamento único).
  if (order.payment?.status === "PENDING") {
    const outcome = await expirePixIfDue(id).catch(() => "NOT_DUE" as const);
    if (outcome === "EXPIRED") order = (await getOrder(id)) ?? order;
  }
  if (order.payment?.status === "PAID" && order.status !== "DELIVERED") {
    const attempted = await attemptAutomaticGuestRecovery(id).catch(() => false);
    if (attempted) order = (await getOrder(id)) ?? order;
  }
  return NextResponse.json({ data: orderDto(order, { includeDelivery: authorizedUser }) });
}
