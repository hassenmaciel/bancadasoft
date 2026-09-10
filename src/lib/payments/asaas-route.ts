import { NextResponse } from "next/server";
import { AsaasPaymentProvider } from "./asaas";
import { validateAsaasWebhookToken } from "./asaas-webhook";
import type { ParsedPaymentWebhook } from "./types";

export type PaymentProcessorResult = { duplicate: boolean; order: unknown } | undefined;
export type PaymentProcessor = (event: ParsedPaymentWebhook) => Promise<PaymentProcessorResult>;

export async function handleAsaasWebhook(request: Request, processor: PaymentProcessor) {
  if (!validateAsaasWebhookToken(request.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "Webhook não autorizado." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const provider = new AsaasPaymentProvider();
  if (!provider.validateWebhook(body)) {
    return NextResponse.json({ error: "Evento Asaas inválido." }, { status: 422 });
  }
  const result = await processor(provider.parseWebhook(body));
  if (!result) {
    return NextResponse.json({ received: true, ignored: true, unmatched: true });
  }
  return NextResponse.json({ received: true, duplicate: result.duplicate });
}
