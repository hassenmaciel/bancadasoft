import { afterEach, describe, expect, it } from "vitest";
import { validateCronSecret } from "./cron-auth";

describe("validateCronSecret — autenticação Bearer do scheduler externo (Supabase Cron)", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("aceita Authorization: Bearer <CRON_SECRET> correto", () => {
    process.env.CRON_SECRET = "a-safe-secret-with-32-characters";
    expect(validateCronSecret("Bearer a-safe-secret-with-32-characters")).toBe(true);
  });

  it("rejeita quando o secret não bate", () => {
    process.env.CRON_SECRET = "a-safe-secret-with-32-characters";
    expect(validateCronSecret("Bearer wrong-secret")).toBe(false);
  });

  it("rejeita sem header Authorization", () => {
    process.env.CRON_SECRET = "a-safe-secret-with-32-characters";
    expect(validateCronSecret(null)).toBe(false);
  });

  it("rejeita sem o prefixo Bearer", () => {
    process.env.CRON_SECRET = "a-safe-secret-with-32-characters";
    expect(validateCronSecret("a-safe-secret-with-32-characters")).toBe(false);
  });

  it("rejeita quando CRON_SECRET não está configurado — nunca autoriza por omissão", () => {
    expect(validateCronSecret("Bearer anything")).toBe(false);
  });
});
