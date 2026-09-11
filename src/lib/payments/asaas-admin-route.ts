import { NextResponse } from "next/server";
import type { AsaasDiagnosticDTO } from "./asaas-diagnostics";

export async function handleAdminAsaasConnectionTest(authorize: () => Promise<unknown>, diagnose: () => Promise<AsaasDiagnosticDTO>) {
  try { await authorize(); }
  catch { return NextResponse.json({ error:"Não autorizado." }, { status:403 }); }
  return NextResponse.json({ data:await diagnose() });
}
