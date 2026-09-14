import { NextResponse } from "next/server";
import { checkoutSchema } from "./checkout-schema";
import { orderDto } from "./dto";
import { AsaasClientError } from "./payments/asaas-client";

type CreateOrder = (
  input: ReturnType<typeof checkoutSchema.parse>,
) => Promise<
  | { order: Parameters<typeof orderDto>[0]; deliveryAccessToken: string }
  | undefined
>;
type SafeLog = (message: string, context: Record<string, unknown>) => void;

function safeCheckoutError(error: unknown) {
  if (error instanceof AsaasClientError)
    return { type: error.name, code: error.message, status: error.status };
  if (error instanceof Error)
    return { type: error.name, code: "CHECKOUT_INTERNAL_ERROR", status: null };
  return { type: "UnknownError", code: "CHECKOUT_INTERNAL_ERROR", status: null };
}

export async function handleCheckoutRequest(
  request: Request,
  create: CreateOrder,
  log: SafeLog = (message, context) => console.error(message, context),
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Dados de checkout inválidos.",
        code: "INVALID_CHECKOUT",
      },
      { status: 400 },
    );
  }

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      {
        ok: false,
        error: "Dados de checkout inválidos.",
        code: "INVALID_CHECKOUT",
      },
      { status: 400 },
    );

  try {
    const result = await create(parsed.data);
    if (!result?.order)
      return NextResponse.json(
        {
          ok: false,
          error: "Produto temporariamente indisponível.",
          code: "PRODUCT_UNAVAILABLE",
        },
        { status: 409 },
      );

    return NextResponse.json(
      {
        ok: true,
        data: orderDto(result.order, { includeDelivery: false }),
        deliveryAccessToken: result.deliveryAccessToken,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "LOGIN_REQUIRED_FOR_PRICE")
      return NextResponse.json({ ok: false, error: "Entre para consultar o preço e concluir a compra.", code: "LOGIN_REQUIRED" }, { status: 401 });
    log("[checkout] Falha ao gerar PIX.", {
      stage: "create_order",
      ...safeCheckoutError(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível gerar o PIX agora. Tente novamente em instantes.",
        code: "CHECKOUT_UNAVAILABLE",
      },
      { status: 500 },
    );
  }
}
