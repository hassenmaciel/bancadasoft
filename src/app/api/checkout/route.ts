import { handleCheckoutRequest } from "@/lib/checkout-route";
import { createOrder } from "@/lib/commerce";

export const POST = (request: Request) => handleCheckoutRequest(request, createOrder);
