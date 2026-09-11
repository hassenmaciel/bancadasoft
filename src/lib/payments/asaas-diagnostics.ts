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
};

type RuntimeConfig = AsaasDiagnosticDTO & { apiKey: string | null; effectiveBaseUrl: string };

const configured = (value: string | undefined) => Boolean(value?.trim());

export function readAsaasRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawProvider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  const provider = rawProvider === "asaas" || rawProvider === "mock" ? rawProvider : "other";
  const rawEnvironment = env.ASAAS_ENV?.trim().toLowerCase();
  const environment = rawEnvironment === "sandbox" || rawEnvironment === "production" ? rawEnvironment : "other";
  const effectiveBaseUrl = env.ASAAS_BASE_URL?.trim() || ASAAS_SANDBOX_URL;
  const baseUrl = ALLOWED_BASE_URLS.get(effectiveBaseUrl as typeof ASAAS_SANDBOX_URL | typeof ASAAS_PRODUCTION_URL) ?? "INVALID";
  const apiKeyConfigured = configured(env.ASAAS_API_KEY);
  const webhookTokenConfigured = configured(env.ASAAS_WEBHOOK_TOKEN);
  const expectedBase = environment === "sandbox" ? "SANDBOX" : environment === "production" ? "PRODUCTION" : null;
  const configurationError = provider !== "asaas" || !apiKeyConfigured || !webhookTokenConfigured || baseUrl === "INVALID" || baseUrl !== expectedBase;
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
    apiKey: apiKeyConfigured ? env.ASAAS_API_KEY! : null,
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
    await response.body?.cancel();
    return { ...publicAsaasDiagnostic(config), ok: response.status === 200, authentication: response.status === 200 ? "ONLINE" : "ERROR", httpStatus: response.status, checkedAt };
  } catch {
    return { ...publicAsaasDiagnostic(config), authentication: "ERROR", checkedAt };
  } finally {
    clearTimeout(timer);
  }
}
