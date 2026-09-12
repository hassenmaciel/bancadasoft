import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { handleAdminPixReconciliation } from "@/lib/admin-pix-route";
import { reconcilePendingPixPayment } from "@/lib/payment-reconciliation";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  return handleAdminPixReconciliation(
    id,
    requireAdmin,
    reconcilePendingPixPayment,
    (adminId, orderId, result) =>
      audit(adminId, "PAYMENT_PIX_RECONCILED", "Order", orderId, {
        result: result.status,
      }),
  );
}
