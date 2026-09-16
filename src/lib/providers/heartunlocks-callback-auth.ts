import { timingSafeEqual } from "node:crypto";

export function validateHeartUnlocksCallbackSecret(
  received: string | null,
  expected = process.env.BANCADASOFT_INTERNAL_SECRET,
) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
