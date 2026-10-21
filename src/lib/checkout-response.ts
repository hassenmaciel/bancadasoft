import type { OrderDTO } from "./dto";

export const CHECKOUT_FALLBACK_ERROR =
  "Não foi possível gerar o PIX agora. Tente novamente em instantes.";

export const BALANCE_CHECKOUT_FALLBACK_ERROR =
  "Não foi possível concluir o pagamento com saldo agora. Confira Meus pedidos antes de tentar novamente.";

const BALANCE_PAYMENT_ERROR_CODES = new Set([
  "LOGIN_REQUIRED_FOR_BALANCE",
  "BALANCE_PERMISSION_REQUIRED",
  "BALANCE_NOT_ENABLED",
  "BALANCE_PAYMENT_NOT_ALLOWED",
  "INSUFFICIENT_BALANCE",
]);

export type CheckoutApiResponse = {
  ok?: boolean;
  data?: OrderDTO;
  deliveryAccessToken?: string;
  error?: string;
  code?: string;
};

export async function readCheckoutResponse(
  response: Pick<Response, "headers" | "text">,
): Promise<CheckoutApiResponse | null> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const body = await response.text();
  if (!body.trim() || !contentType.includes("application/json")) return null;

  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object"
      ? (parsed as CheckoutApiResponse)
      : null;
  } catch {
    return null;
  }
}

export function checkoutErrorMessage(
  status: number,
  payload: CheckoutApiResponse | null,
  paymentMethod: "pix" | "balance" = "pix",
) {
  if (payload?.code === "INVALID_QUANTITY" && payload.error) return payload.error;
  // Erros do pagamento por saldo já chegam com texto final para o cliente.
  // Só no envio por saldo: as mensagens do PIX ficam exatamente como eram.
  if (paymentMethod === "balance" && payload?.code && BALANCE_PAYMENT_ERROR_CODES.has(payload.code) && payload.error)
    return payload.error;
  // Códigos exclusivos do PIX do PREMIUM_PLUS; nenhum outro envio PIX os recebe.
  if (payload?.code === "PIX_NOT_ALLOWED_FOR_TIER" && payload.error) return payload.error;
  if (payload?.code === "PIX_PRICE_UNAVAILABLE_FOR_TIER" && payload.error) return payload.error;
  // Recarga bloqueada pelo Admin: o texto final vem do servidor.
  if (payload?.code === "BALANCE_TOPUP_BLOCKED" && payload.error) return payload.error;
  if (payload?.code === "INVALID_TOPUP_AMOUNT" && payload.error) return payload.error;
  if (status === 400 || payload?.code === "INVALID_CHECKOUT" || payload?.code === "INVALID_CUSTOMER_DATA")
    return "Revise os dados informados e tente novamente.";
  if (payload?.code === "MISSING_CUSTOMER_FIELDS")
    return "Complete os dados faltantes do seu cadastro para continuar.";
  if (status === 409 || payload?.code === "PRODUCT_UNAVAILABLE")
    return "Este produto está temporariamente indisponível.";
  return paymentMethod === "balance" ? BALANCE_CHECKOUT_FALLBACK_ERROR : CHECKOUT_FALLBACK_ERROR;
}

export function createCheckoutSubmissionGuard() {
  let active = false;
  return {
    acquire() {
      if (active) return false;
      active = true;
      return true;
    },
    release() {
      active = false;
    },
  };
}
