import { describe, expect, it } from "vitest";
import { saoPauloDayStart } from "./sao-paulo-day";

const start = (iso: string) => saoPauloDayStart(new Date(iso)).toISOString();

describe("saoPauloDayStart", () => {
  it("20h30 em Brasília (23:30Z) é o dia 20", () => {
    expect(start("2026-10-20T23:30:00Z")).toBe("2026-10-20T03:00:00.000Z");
  });

  it("21h30 em Brasília (00:30Z do dia 21) ainda é o dia 20 — caso do bug", () => {
    expect(start("2026-10-21T00:30:00Z")).toBe("2026-10-20T03:00:00.000Z");
  });

  it("vira o dia exatamente à meia-noite de São Paulo (03:00Z)", () => {
    expect(start("2026-10-21T02:59:59Z")).toBe("2026-10-20T03:00:00.000Z");
    expect(start("2026-10-21T02:59:59.999Z")).toBe("2026-10-20T03:00:00.000Z");
    expect(start("2026-10-21T03:00:00Z")).toBe("2026-10-21T03:00:00.000Z");
  });

  it("virada de mês", () => {
    expect(start("2026-11-01T02:30:00Z")).toBe("2026-10-31T03:00:00.000Z");
    expect(start("2026-11-01T03:00:00Z")).toBe("2026-11-01T03:00:00.000Z");
  });

  it("virada de ano", () => {
    expect(start("2027-01-01T02:59:59Z")).toBe("2026-12-31T03:00:00.000Z");
    expect(start("2027-01-01T03:00:00Z")).toBe("2027-01-01T03:00:00.000Z");
  });
});
