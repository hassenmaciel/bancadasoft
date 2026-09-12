import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getAuthSecret } from "./auth-secret";

export const DELIVERY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DELIVERY_RATE_LIMIT = 10;
export const DELIVERY_RATE_WINDOW_MS = 5 * 60 * 1000;

const encryptionKey = () =>
  createHash("sha256")
    .update(getAuthSecret())
    .update("guest-delivery-v1")
    .digest();
export function encryptDeliveryToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function decryptDeliveryToken(value: string) {
  try {
    const packed = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
export function createDeliveryAccess(now = new Date(), suppliedToken?: string) {
  const token = suppliedToken ?? randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashDeliveryToken(token),
    encryptedToken: encryptDeliveryToken(token),
    expiresAt: new Date(now.getTime() + DELIVERY_TOKEN_TTL_MS),
  };
}
export const hashDeliveryToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function deliveryTokenMatches(
  token: string,
  expectedHash: string | null,
  expiresAt: Date | null,
  revokedAt: Date | null,
  now = new Date(),
) {
  if (!token || !expectedHash || !expiresAt || revokedAt || expiresAt <= now)
    return false;
  const actual = Buffer.from(hashDeliveryToken(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function deliveryAccessFingerprint(value: string) {
  return createHmac("sha256", getAuthSecret())
    .update(value || "unknown")
    .digest("hex");
}
