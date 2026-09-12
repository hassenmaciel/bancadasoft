import { NextResponse } from "next/server";
import { orderDto } from "./dto";

export type SavedCheckoutReference = {
  id?: string;
  publicToken?: string;
  deliveryAccessToken?: string;
};

export function parseSavedCheckoutReference(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const reference: SavedCheckoutReference = {
      id: typeof parsed.id === "string" ? parsed.id : undefined,
      publicToken:
        typeof parsed.publicToken === "string" ? parsed.publicToken : undefined,
      deliveryAccessToken:
        typeof parsed.deliveryAccessToken === "string" &&
        parsed.deliveryAccessToken.length >= 32 &&
        parsed.deliveryAccessToken.length <= 200
          ? parsed.deliveryAccessToken
          : undefined,
    };
    return reference.id || reference.deliveryAccessToken ? reference : null;
  } catch {
    return null;
  }
}

export const needsGuestCheckoutRecovery = (reference: SavedCheckoutReference) =>
  !reference.id &&
  !reference.publicToken &&
  Boolean(reference.deliveryAccessToken);

type RecoverOrder = (
  token: string,
) => Promise<Parameters<typeof orderDto>[0] | null>;

export async function handleCheckoutRecoveryRequest(
  request: Request,
  recover: RecoverOrder,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const token =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).deliveryAccessToken
      : null;
  if (typeof token !== "string" || token.length < 32 || token.length > 200)
    return NextResponse.json(
      { ok: false, error: "Checkout não encontrado.", code: "INVALID_RECOVERY" },
      { status: 400 },
    );
  try {
    const order = await recover(token);
    if (!order)
      return NextResponse.json(
        { ok: false, error: "Checkout não encontrado.", code: "RECOVERY_NOT_FOUND" },
        { status: 404 },
      );
    return NextResponse.json({
      ok: true,
      data: orderDto(order, { includeDelivery: false }),
      deliveryAccessToken: token,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Não foi possível recuperar o checkout agora.", code: "RECOVERY_UNAVAILABLE" },
      { status: 500 },
    );
  }
}
