import { NextResponse } from "next/server";
import type { DeliveryDTO } from "./dto";

type Admin = { id: string };
type DeliveryResult = { status: string; delivery: DeliveryDTO | null };
type ResendResult = { status: string };

/**
 * PARTE 7/8/17: expõe a entrega já persistida somente para ADMIN autenticado,
 * como uma ação explícita e auditável — nunca embutida na listagem/HTML
 * público. Reaproveita a mesma fonte (Fulfillment.delivery via
 * customerDelivery) usada no acesso seguro do cliente.
 */
export async function handleAdminDeliveryReveal(
  orderId: string,
  authorize: () => Promise<Admin>,
  loadDelivery: (orderId: string) => Promise<DeliveryResult | null>,
  recordAudit: (adminId: string, orderId: string) => Promise<unknown>,
) {
  let admin: Admin;
  try {
    admin = await authorize();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  const result = await loadDelivery(orderId);
  if (!result)
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  await recordAudit(admin.id, orderId);
  return NextResponse.json({ data: result });
}

const resendErrorMessage = (status: string) => {
  if (status === "SKIPPED")
    return "Este pedido não possui entrega concluída para reenviar.";
  if (status === "NOT_CONFIGURED")
    return "O envio de e-mail não está configurado.";
  return "Não foi possível reenviar o acesso agora.";
};

/**
 * PARTE 9/18: reenvia o acesso já entregue — nunca cria Order/Payment/
 * ProviderOrder/Fulfillment/credential novos, apenas reaproveita a entrega e
 * o link seguro existentes (ver resendDeliveryEmail).
 */
export async function handleAdminDeliveryResend(
  orderId: string,
  authorize: () => Promise<Admin>,
  resend: (orderId: string) => Promise<ResendResult>,
  recordAudit: (adminId: string, orderId: string, result: ResendResult) => Promise<unknown>,
) {
  let admin: Admin;
  try {
    admin = await authorize();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  try {
    const result = await resend(orderId);
    if (result.status === "SENT" || result.status === "DUPLICATE") {
      await recordAudit(admin.id, orderId, result);
      return NextResponse.json({ data: result });
    }
    return NextResponse.json(
      { error: resendErrorMessage(result.status), code: result.status },
      { status: 409 },
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível reenviar o acesso agora.", code: "RESEND_FAILED" },
      { status: 502 },
    );
  }
}
