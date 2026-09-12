import { NextResponse } from "next/server";
import { createOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
import { checkoutSchema } from "@/lib/checkout-schema";
export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Dados de checkout inválidos.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  const result = await createOrder(parsed.data);
  if (!result?.order)
    return NextResponse.json(
      { error: "Produto temporariamente indisponível." },
      { status: 409 },
    );
  return NextResponse.json(
    {
      data: orderDto(result.order, { includeDelivery: false }),
      deliveryAccessToken: result.deliveryAccessToken,
    },
    { status: 201 },
  );
}
