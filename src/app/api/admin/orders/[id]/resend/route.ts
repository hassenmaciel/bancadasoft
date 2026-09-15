import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { resendDeliveryEmail } from "@/lib/notifications/delivery-email";
import { handleAdminDeliveryResend } from "@/lib/admin-delivery-route";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  return handleAdminDeliveryResend(
    id,
    requireAdmin,
    resendDeliveryEmail,
    (adminId, orderId, result) =>
      audit(adminId, "ORDER_DELIVERY_RESENT", "Order", orderId, { result: result.status }),
  );
}
