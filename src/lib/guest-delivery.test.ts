import { beforeEach, describe, expect, it } from "vitest";
import {
  createDeliveryAccess,
  decryptDeliveryToken,
  deliveryTokenMatches,
  hashDeliveryToken,
} from "./guest-delivery";

describe("acesso seguro à entrega sem cadastro", () => {
  beforeEach(()=>{process.env.AUTH_SECRET="isolated-test-secret-with-more-than-32-bytes"});
  it("persiste somente hash e aceita o token correto", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    const access = createDeliveryAccess(now);
    expect(access.tokenHash).toBe(hashDeliveryToken(access.token));
    expect(access.tokenHash).not.toContain(access.token);
    expect(
      deliveryTokenMatches(
        access.token,
        access.tokenHash,
        access.expiresAt,
        null,
        now,
      ),
    ).toBe(true);
    expect(decryptDeliveryToken(access.encryptedToken)).toBe(access.token);
  });
  it("reutiliza um token fornecido como chave idempotente do checkout", () => {
    const token = "checkout-token-with-at-least-32-characters";
    const first = createDeliveryAccess(new Date(), token);
    const retry = createDeliveryAccess(new Date(), token);
    expect(first.tokenHash).toBe(retry.tokenHash);
    expect(first.token).toBe(token);
  });
  it("rejeita token incorreto, expirado ou revogado", () => {
    const now = new Date("2026-09-11T12:00:00Z");
    const access = createDeliveryAccess(now);
    expect(
      deliveryTokenMatches(
        "wrong",
        access.tokenHash,
        access.expiresAt,
        null,
        now,
      ),
    ).toBe(false);
    expect(
      deliveryTokenMatches(access.token, access.tokenHash, now, null, now),
    ).toBe(false);
    expect(
      deliveryTokenMatches(
        access.token,
        access.tokenHash,
        access.expiresAt,
        now,
        now,
      ),
    ).toBe(false);
  });
});
