import { handleCheckoutRequest } from "@/lib/checkout-route";
import { createOrder } from "@/lib/commerce";
import { session } from "@/lib/auth";

export async function POST(request: Request) {
  const viewer = await session();
  return handleCheckoutRequest(request, (input) => createOrder(input, viewer?.id));
}
