import { describe, expect, it } from "vitest";
import { resolveAsaasApiKey } from "./asaas-api-key";
import { readAsaasRuntimeConfig, publicAsaasDiagnostic, ASAAS_SANDBOX_URL } from "./asaas-diagnostics";

const FAKE = "fake-key-for-tests-123";
const b64 = (v: string) => Buffer.from(v, "utf8").toString("base64");

describe("resolveAsaasApiKey", () => {
  it("decodes a valid b64 value", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: b64(FAKE) })).toEqual({ key: FAKE, source: "b64", reason: "ok" }));
  it("trims whitespace and line breaks around the decoded value", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: b64(`  ${FAKE}\r\n`) }).key).toBe(FAKE));
  it("tolerates a line break inside the b64 text", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: `${b64(FAKE)}\n` })).toMatchObject({ key: FAKE, source: "b64", reason: "ok" }));
  it("rejects b64 that decodes to control characters without falling back", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: b64("fake\nkey"), ASAAS_API_KEY: FAKE })).toEqual({ key: null, source: "b64", reason: "b64_invalid" }));
  it("rejects b64 that decodes to nothing without falling back", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: b64("   "), ASAAS_API_KEY: FAKE })).toEqual({ key: null, source: "b64", reason: "b64_invalid" }));
  it("uses plain when b64 is absent or empty", () => {
    expect(resolveAsaasApiKey({ ASAAS_API_KEY: ` ${FAKE} ` })).toEqual({ key: FAKE, source: "plain", reason: "ok" });
    expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: "  ", ASAAS_API_KEY: FAKE }).source).toBe("plain");
  });
  it("b64 wins over plain", () => expect(resolveAsaasApiKey({ ASAAS_API_KEY_B64: b64(FAKE), ASAAS_API_KEY: "other-fake-plain" }).key).toBe(FAKE));
  it("reports none when nothing is set", () => expect(resolveAsaasApiKey({})).toEqual({ key: null, source: "none", reason: "missing" }));
});

describe("diagnostic output never contains the key", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PAYMENT_PROVIDER: "asaas", ASAAS_ENV: "sandbox", ASAAS_BASE_URL: ASAAS_SANDBOX_URL, ASAAS_WEBHOOK_TOKEN: "fake-webhook", ASAAS_API_KEY_B64: b64(FAKE) };
  it("exposes only source and reason", () => {
    const out = JSON.stringify(publicAsaasDiagnostic(readAsaasRuntimeConfig(env)));
    expect(out).not.toContain(FAKE);
    expect(out).not.toContain(b64(FAKE));
    expect(out).toContain('"apiKeySource":"b64"');
    expect(out).toContain('"apiKeyReason":"ok"');
  });
  it("reports b64_invalid as a configuration error", () => {
    const out = publicAsaasDiagnostic(readAsaasRuntimeConfig({ ...env, ASAAS_API_KEY_B64: b64("fake\nkey"), ASAAS_API_KEY: FAKE }));
    expect(out).toMatchObject({ reason: "API_KEY_B64_INVALID", apiKeySource: "b64", apiKeyReason: "b64_invalid", configurationError: true });
    expect(JSON.stringify(out)).not.toContain(FAKE);
  });
});
