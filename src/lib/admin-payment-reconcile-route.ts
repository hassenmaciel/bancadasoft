import { NextResponse } from "next/server";
import { PaymentReconcileError } from "./admin-payment-reconcile";
import { PAYMENT_RECONCILE_ERROR_MESSAGES, type PaymentReconcileErrorCode } from "./payment-reconcile-rules";

type Admin = { id: string };

const statusFor = (code: PaymentReconcileErrorCode) =>
  code === "ORDER_NOT_FOUND"
    ? 404
    : code === "ASAAS_UNAVAILABLE"
      ? 502
      : code === "ASAAS_NOT_CONFIGURED"
        ? 503
        : 409;

export async function handleAdminPaymentReconcile(
  orderId: string,
  authorize: () => Promise<Admin>,
  reconcile: (input: { orderId: string; adminId: string }) => Promise<unknown>,
) {
  let admin: Admin;
  try {
    admin = await authorize();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  try {
    return NextResponse.json({ data: await reconcile({ orderId, adminId: admin.id }) });
  } catch (error) {
    if (error instanceof PaymentReconcileError)
      return NextResponse.json(
        { error: PAYMENT_RECONCILE_ERROR_MESSAGES[error.code], code: error.code },
        { status: statusFor(error.code) },
      );
    console.error("[admin] reconcile-payment falhou.", {
      orderId,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Não foi possível reconciliar o pagamento.", code: "PAYMENT_RECONCILE_FAILED" },
      { status: 500 },
    );
  }
}
