import { describe, expect, it, vi } from "vitest";
import { isAdminRole } from "../authorization";
import { ASAAS_SANDBOX_URL, publicAsaasDiagnostic, readAsaasRuntimeConfig, testAsaasConnection } from "./asaas-diagnostics";
import { handleAdminAsaasConnectionTest } from "./asaas-admin-route";

const validEnv = { PAYMENT_PROVIDER:"asaas", ASAAS_ENV:"sandbox", ASAAS_BASE_URL:ASAAS_SANDBOX_URL, ASAAS_API_KEY:"test-only-key", ASAAS_WEBHOOK_TOKEN:"test-only-webhook" };

describe("Asaas admin diagnostic", () => {
  it("recognizes ADMIN and blocks USER through the shared authorization rule", () => { expect(isAdminRole("ADMIN")).toBe(true); expect(isAdminRole("USER")).toBe(false); });
  it("reports Asaas and Mock selections", () => { expect(readAsaasRuntimeConfig(validEnv).provider).toBe("asaas"); expect(readAsaasRuntimeConfig({ ...validEnv, PAYMENT_PROVIDER:"mock" }).provider).toBe("mock"); });
  it.each([undefined, "", "   "])("rejects a missing or blank API key", (key) => expect(readAsaasRuntimeConfig({ ...validEnv, ASAAS_API_KEY:key }).configurationError).toBe(true));
  it("rejects a base URL outside the allowlist", () => expect(readAsaasRuntimeConfig({ ...validEnv, ASAAS_BASE_URL:"https://example.test/v3" })).toMatchObject({ baseUrl:"INVALID", baseUrlStatus:"INVALID", configurationError:true }));
  it("reports authenticated HTTP 200 without returning the response body", async () => { const result=await testAsaasConnection(validEnv,vi.fn(async()=>new Response(JSON.stringify({balance:999}),{status:200})));expect(result).toMatchObject({ok:true,authentication:"ONLINE",httpStatus:200});expect(JSON.stringify(result)).not.toContain("balance"); });
  it("reports HTTP 401 safely", async () => expect(testAsaasConnection(validEnv,vi.fn(async()=>new Response(null,{status:401})))).resolves.toMatchObject({ok:false,authentication:"ERROR",httpStatus:401}));
  it("reports timeout/network failure without leaking configuration", async () => { const result=await testAsaasConnection(validEnv,vi.fn(async()=>{throw new DOMException("Aborted","AbortError")}));expect(result).toMatchObject({ok:false,authentication:"ERROR",httpStatus:null});expect(JSON.stringify(result)).not.toContain("test-only-key"); });
  it("safe configuration never exposes keys, tokens, or the effective URL", () => { const result=publicAsaasDiagnostic(readAsaasRuntimeConfig(validEnv));expect(result).not.toHaveProperty("apiKey");expect(result).not.toHaveProperty("effectiveBaseUrl");expect(JSON.stringify(result)).not.toContain("test-only"); });
  it("allows ADMIN to run the protected diagnostic", async () => { const response=await handleAdminAsaasConnectionTest(async()=>({role:"ADMIN"}),async()=>testAsaasConnection(validEnv,vi.fn(async()=>new Response(null,{status:200}))));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({data:{authentication:"ONLINE"}}); });
  it("blocks USER before the diagnostic executes", async () => { const diagnose=vi.fn();const response=await handleAdminAsaasConnectionTest(async()=>{throw new Error("FORBIDDEN")},diagnose);expect(response.status).toBe(403);expect(diagnose).not.toHaveBeenCalled(); });
});
