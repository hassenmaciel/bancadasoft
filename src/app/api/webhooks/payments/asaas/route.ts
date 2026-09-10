import { processPayment } from "@/lib/commerce";
import { handleAsaasWebhook } from "@/lib/payments/asaas-route";

export async function POST(request: Request) {
  return handleAsaasWebhook(request, processPayment);
}
