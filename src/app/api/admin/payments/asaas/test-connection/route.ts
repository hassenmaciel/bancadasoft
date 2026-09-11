import { requireAdmin } from "@/lib/auth";
import { testAsaasConnection } from "@/lib/payments/asaas-diagnostics";
import { handleAdminAsaasConnectionTest } from "@/lib/payments/asaas-admin-route";

export async function POST() {
  return handleAdminAsaasConnectionTest(requireAdmin, () => testAsaasConnection());
}
