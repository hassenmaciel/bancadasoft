export const ASAAS_SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
export const ASAAS_PRODUCTION_URL = "https://api.asaas.com/v3";
const ALLOWED_BASE_URLS = new Map([
  [ASAAS_SANDBOX_URL, "SANDBOX"],
  [ASAAS_PRODUCTION_URL, "PRODUCTION"],
] as const);

export type AsaasDiagnosticDTO = {
  ok: boolean;
  provider: "asaas" | "mock" | "other";
  environment: "sandbox" | "production" | "other";
  baseUrl: "SANDBOX" | "PRODUCTION" | "INVALID";
  baseUrlStatus: "OK" | "INVALID";
  apiKeyConfigured: boolean;
  webhookTokenConfigured: boolean;
  authentication: "ONLINE" | "ERROR" | "NOT_TESTED";
  httpStatus: number | null;
  checkedAt: string | null;
  configurationError: boolean;
  reason: "PROVIDER_INVALID" | "ENVIRONMENT_INVALID" | "BASE_URL_INVALID" | "API_KEY_MISSING" | "WEBHOOK_TOKEN_MISSING" | "AUTHENTICATION_FAILED" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | null;
};

type RuntimeConfig = AsaasDiagnosticDTO & { apiKey: string | null; effectiveBaseUrl: string };

const configured = (value: string | undefined) => Boolean(value?.trim());

export function readAsaasRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawProvider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  const provider = rawProvider === "asaas" || rawProvider === "mock" ? rawProvider : "other";
  const rawEnvironment = env.ASAAS_ENV?.trim().toLowerCase();
  const environment = rawEnvironment === "sandbox" || rawEnvironment === "production" ? rawEnvironment : "other";
  const effectiveBaseUrl = (env.ASAAS_BASE_URL?.trim() || ASAAS_SANDBOX_URL).replace(/\/+$/, "");
  const baseUrl = ALLOWED_BASE_URLS.get(effectiveBaseUrl as typeof ASAAS_SANDBOX_URL | typeof ASAAS_PRODUCTION_URL) ?? "INVALID";
  const apiKey = env.ASAAS_API_KEY?.trim() || null;
  const apiKeyConfigured = Boolean(apiKey);
  const webhookTokenConfigured = configured(env.ASAAS_WEBHOOK_TOKEN);
  const expectedBase = environment === "sandbox" ? "SANDBOX" : environment === "production" ? "PRODUCTION" : null;
  const reason = provider !== "asaas" ? "PROVIDER_INVALID" : environment === "other" ? "ENVIRONMENT_INVALID" : baseUrl === "INVALID" || baseUrl !== expectedBase ? "BASE_URL_INVALID" : !apiKeyConfigured ? "API_KEY_MISSING" : !webhookTokenConfigured ? "WEBHOOK_TOKEN_MISSING" : null;
  const configurationError = reason !== null;
  return {
    ok: false,
    provider,
    environment,
    baseUrl,
    baseUrlStatus: baseUrl === "INVALID" ? "INVALID" : "OK",
    apiKeyConfigured,
    webhookTokenConfigured,
    authentication: "NOT_TESTED",
    httpStatus: null,
    checkedAt: null,
    configurationError,
    reason,
    apiKey,
    effectiveBaseUrl,
  };
}

export function publicAsaasDiagnostic(config: RuntimeConfig): AsaasDiagnosticDTO {
  const { apiKey: _apiKey, effectiveBaseUrl: _effectiveBaseUrl, ...safe } = config;
  return safe;
}

export async function testAsaasConnection(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<AsaasDiagnosticDTO> {
  const config = readAsaasRuntimeConfig(env);
  const checkedAt = new Date().toISOString();
  if (config.configurationError || !config.apiKey) return { ...publicAsaasDiagnostic(config), authentication: "ERROR", checkedAt };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(`${config.effectiveBaseUrl}/finance/balance`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: config.apiKey,
        "user-agent": "BancadaSoft-Admin-Diagnostic/1.0",
      },
    });
    try { await response.body?.cancel(); } catch { /* status remains authoritative; response content is intentionally discarded */ }
    const ok = response.status === 200;
    return { ...publicAsaasDiagnostic(config), ok, authentication: ok ? "ONLINE" : "ERROR", httpStatus: response.status, checkedAt, reason:ok?null:response.status===401?"AUTHENTICATION_FAILED":"HTTP_ERROR" };
  } catch (error) {
    return { ...publicAsaasDiagnostic(config), authentication: "ERROR", checkedAt, reason:error instanceof Error&&error.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}
