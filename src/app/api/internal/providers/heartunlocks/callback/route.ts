import { NextResponse } from "next/server";
import { z } from "zod";
import { processHeartUnlocksCallback } from "@/lib/providers/heartunlocks-callback";
import { validateHeartUnlocksCallbackSecret } from "@/lib/providers/heartunlocks-callback-auth";
import { sendDeliveryEmail } from "@/lib/notifications/delivery-email";
const schema = z.object({
  reference_id: z.string().min(1).max(200),
  order_id: z.string().min(1).max(200),
  status: z.string().min(1).max(40),
  replay: z.string().max(20000).optional(),
});
export async function POST(request: Request) {
  if (!validateHeartUnlocksCallbackSecret(request.headers.get("x-internal-secret")))
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Payload inválido." }, { status: 422 });
  const result = await processHeartUnlocksCallback(parsed.data);
  const internal = result as typeof result & { delivered?: boolean; orderId?: string };
  if (internal.delivered && internal.orderId)
    await sendDeliveryEmail(internal.orderId).catch(() => undefined);
  const { orderId: _orderId, ...safeResult } = internal;
  return NextResponse.json({ received: true, ...safeResult });
}
