import { prisma } from "@/lib/prisma";
import { getOrder } from "@/lib/commerce";
import {
  deliveryTokenMatches,
  hashDeliveryToken,
} from "@/lib/guest-delivery";
import { handleCheckoutRecoveryRequest } from "@/lib/checkout-recovery";

export const dynamic = "force-dynamic";

async function recoverOrder(deliveryAccessToken: string) {
  const reference = await prisma.order.findUnique({
    where: { deliveryTokenHash: hashDeliveryToken(deliveryAccessToken) },
    select: {
      id: true,
      deliveryTokenHash: true,
      deliveryTokenExpiresAt: true,
      deliveryTokenRevokedAt: true,
    },
  });
  if (
    !reference ||
    !deliveryTokenMatches(
      deliveryAccessToken,
      reference.deliveryTokenHash,
      reference.deliveryTokenExpiresAt,
      reference.deliveryTokenRevokedAt,
    )
  )
    return null;
  return getOrder(reference.id);
}

export const POST = (request: Request) =>
  handleCheckoutRecoveryRequest(request, recoverOrder);
