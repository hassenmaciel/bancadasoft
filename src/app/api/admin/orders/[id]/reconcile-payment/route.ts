import { requireAdmin } from "@/lib/auth";
import { reconcileAsaasPayment } from "@/lib/admin-payment-reconcile";
import { handleAdminPaymentReconcile } from "@/lib/admin-payment-reconcile-route";

type Context = { params: Promise<{ id: string }> };

// Consulta GET /payments/{id} no Asaas e, se RECEIVED com valor, referência e
// id batendo com o pedido, confirma o pagamento e dispara o fulfillment —
// para quando o webhook do Asaas não chegou. Ver reconcileAsaasPayment.
export async function POST(_: Request, context: Context) {
  const { id } = await context.params;
  return handleAdminPaymentReconcile(id, requireAdmin, (input) => reconcileAsaasPayment(input));
}
