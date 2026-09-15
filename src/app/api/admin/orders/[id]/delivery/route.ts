import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { customerDelivery } from "@/lib/customer-delivery";
import { handleAdminDeliveryReveal } from "@/lib/admin-delivery-route";

type Context = { params: Promise<{ id: string }> };

async function loadDelivery(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, fulfillment: { select: { delivery: true } } },
  });
  if (!order) return null;
  return {
    status: order.status,
    delivery: customerDelivery(order.fulfillment?.delivery),
  };
}

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  return handleAdminDeliveryReveal(
    id,
    requireAdmin,
    loadDelivery,
    (adminId, orderId) => audit(adminId, "ORDER_DELIVERY_VIEWED", "Order", orderId),
  );
}
