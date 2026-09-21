import { describe, expect, it } from "vitest";
import { PIX_ALERT_MS, PIX_VALIDITY_MS, formatPixCountdown, isLegacyPixExpiry, isPixExpired, pixExpiresAt, pixRemainingMs } from "./pix-expiry";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");

describe("validade do PIX", () => {
  it("é de 30 minutos a partir da criação", () => {
    expect(PIX_VALIDITY_MS).toBe(30 * 60 * 1000);
    expect(pixExpiresAt(new Date(T0)).getTime()).toBe(T0 + 30 * 60 * 1000);
  });
  it("PIX dentro do prazo não está expirado; no instante exato e depois, está", () => {
    const expires = pixExpiresAt(new Date(T0));
    expect(isPixExpired(expires, T0 + PIX_VALIDITY_MS - 1)).toBe(false);
    expect(isPixExpired(expires, T0 + PIX_VALIDITY_MS)).toBe(true);
    expect(isPixExpired(expires, T0 + PIX_VALIDITY_MS + 5000)).toBe(true);
  });
});

describe("contador regressivo", () => {
  const expires = new Date(T0 + PIX_VALIDITY_MS);
  it("usa o horário do servidor, ignorando um relógio do cliente adiantado em 1h", () => {
    const clientSkew = 60 * 60 * 1000;
    const receivedAt = T0 + clientSkew; // Date.now() do cliente ao receber
    expect(pixRemainingMs(expires, new Date(T0), receivedAt, receivedAt)).toBe(PIX_VALIDITY_MS);
    expect(pixRemainingMs(expires, new Date(T0), receivedAt, receivedAt + 10_000)).toBe(PIX_VALIDITY_MS - 10_000);
  });
  it("quem paga com 1 segundo de sobra ainda vê tempo restante", () => {
    const remaining = pixRemainingMs(expires, new Date(expires.getTime() - 1000), 5_000_000, 5_000_000);
    expect(remaining).toBe(1000);
    expect(formatPixCountdown(remaining)).toBe("00:01");
  });
  it("chega a zero, nunca fica negativo, e mostra 00:00", () => {
    const remaining = pixRemainingMs(expires, new Date(T0), 0, PIX_VALIDITY_MS + 60_000);
    expect(remaining).toBe(0);
    expect(formatPixCountdown(remaining)).toBe("00:00");
  });
  it("formata mm:ss e o alerta vale nos últimos 5 minutos", () => {
    expect(formatPixCountdown(PIX_VALIDITY_MS)).toBe("30:00");
    expect(formatPixCountdown(65_000)).toBe("01:05");
    expect(PIX_ALERT_MS).toBe(5 * 60 * 1000);
  });
});

describe("contador limitado e PIX legado", () => {
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  it("nunca exibe mais que a validade, mesmo com expiresAt de 1 ano", () => {
    const remaining = pixRemainingMs(new Date(T0 + YEAR), new Date(T0), 0, 0);
    expect(remaining).toBe(PIX_VALIDITY_MS);
    expect(formatPixCountdown(remaining)).toBe("30:00");
  });
  it("detecta legado só além de agora + validade + 60 s", () => {
    expect(isLegacyPixExpiry(new Date(T0 + YEAR), T0)).toBe(true);
    expect(isLegacyPixExpiry(new Date(T0 + PIX_VALIDITY_MS + 60_000), T0)).toBe(false);
    expect(isLegacyPixExpiry(new Date(T0 + PIX_VALIDITY_MS + 60_001), T0)).toBe(true);
    expect(isLegacyPixExpiry(new Date(T0 - 1000), T0)).toBe(false);
  });
});
