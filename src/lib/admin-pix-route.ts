import { NextResponse } from "next/server";

type Admin = { id: string };
type Result = { status: string };

export async function handleAdminPixReconciliation(
  orderId: string,
  authorize: () => Promise<Admin>,
  reconcile: (orderId: string) => Promise<Result>,
  recordAudit: (adminId: string, orderId: string, result: Result) => Promise<unknown>,
) {
  let admin: Admin;
  try {
    admin = await authorize();
  } catch {
    return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  }
  try {
    const result = await reconcile(orderId);
    if (result.status !== "RECONCILED" && result.status !== "ALREADY_AVAILABLE")
      return NextResponse.json(
        { error: "Esta cobrança não pode ser reconciliada automaticamente.", code: result.status },
        { status: 409 },
      );
    await recordAudit(admin.id, orderId, result);
    return NextResponse.json({ data: result });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível recuperar o PIX da cobrança existente.", code: "PIX_RECONCILIATION_FAILED" },
      { status: 502 },
    );
  }
}
