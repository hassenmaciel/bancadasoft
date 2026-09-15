import type { OrderDTO } from "./dto";

export const CHECKOUT_FALLBACK_ERROR =
  "Não foi possível gerar o PIX agora. Tente novamente em instantes.";

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
) {
  if (status === 400 || payload?.code === "INVALID_CHECKOUT" || payload?.code === "INVALID_CUSTOMER_DATA")
    return "Revise os dados informados e tente novamente.";
  if (payload?.code === "MISSING_CUSTOMER_FIELDS")
    return "Complete os dados faltantes do seu cadastro para continuar.";
  if (status === 409 || payload?.code === "PRODUCT_UNAVAILABLE")
    return "Este produto está temporariamente indisponível.";
  return CHECKOUT_FALLBACK_ERROR;
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
