import { resolveAsaasApiKey } from "./asaas-api-key";
export const ASAAS_SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
export const ASAAS_PRODUCTION_URL = "https://api.asaas.com/v3";
const ALLOWED_BASE_URLS = new Map([
  [ASAAS_SANDBOX_URL, "SANDBOX"],
  [ASAAS_PRODUCTION_URL, "PRODUCTION"],
] as const);

type ErrorCategory = "DNS" | "TLS" | "SOCKET" | "HEADER" | "TIMEOUT" | "URL" | "NETWORK";
type SafeError = {
  constructorName: string | null;
  name: string | null;
  code: string | null;
  errno: string | null;
  syscall: string | null;
  hostname: string | null;
  causeConstructorName: string | null;
  causeName: string | null;
  causeCode: string | null;
  causeErrno: string | null;
  causeSyscall: string | null;
  causeHostname: string | null;
  category: ErrorCategory;
  message: string;
};

export type AsaasDiagnosticDTO = {
  ok: boolean;
  provider: "asaas" | "mock" | "other";
  environment: "sandbox" | "production" | "other";
  baseUrl: "SANDBOX" | "PRODUCTION" | "INVALID";
  baseUrlStatus: "OK" | "INVALID";
  apiKeyConfigured: boolean;
  apiKeySource: "b64" | "plain" | "none";
  apiKeyReason: "ok" | "b64_invalid" | "missing";
  webhookTokenConfigured: boolean;
  authentication: "ONLINE" | "ERROR" | "NOT_TESTED";
  httpStatus: number | null;
  checkedAt: string | null;
  configurationError: boolean;
  reason: "PROVIDER_INVALID" | "ENVIRONMENT_INVALID" | "BASE_URL_INVALID" | "API_KEY_MISSING" | "API_KEY_B64_INVALID" | "API_KEY_HEADER_INVALID" | "WEBHOOK_TOKEN_MISSING" | "AUTHENTICATION_FAILED" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR" | null;
  category: ErrorCategory | "HTTP" | "AUTH" | null;
  target: { host: string; path: string } | null;
  requestUrlValid: boolean;
  apiKeyHeaderValid: boolean;
  requestAttempted: boolean;
  error: SafeError | null;
  connectivity: { attempted: boolean; reachable: boolean | null; httpStatus: number | null; error: SafeError | null };
};

type RuntimeConfig = AsaasDiagnosticDTO & { apiKey: string | null; effectiveBaseUrl: string };

const configured = (value: string | undefined) => Boolean(value?.trim());
const safeText = (value: unknown, max = 120) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return text.length <= max && /^[a-zA-Z0-9._:/-]+$/.test(text) ? text : null;
};
const constructorName = (value: unknown) => {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  return safeText(Object.getPrototypeOf(value)?.constructor?.name);
};

function safeFetchError(error: unknown): SafeError {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const causeValue = Reflect.get(record, "cause");
  const cause = causeValue && typeof causeValue === "object" ? causeValue as Record<string, unknown> : {};
  const details = {
    constructorName: constructorName(error),
    name: safeText(Reflect.get(record, "name")),
    code: safeText(Reflect.get(record, "code")),
    errno: safeText(Reflect.get(record, "errno")),
    syscall: safeText(Reflect.get(record, "syscall")),
    hostname: safeText(Reflect.get(record, "hostname")),
    causeConstructorName: constructorName(causeValue),
    causeName: safeText(Reflect.get(cause, "name")),
    causeCode: safeText(Reflect.get(cause, "code")),
    causeErrno: safeText(Reflect.get(cause, "errno")),
    causeSyscall: safeText(Reflect.get(cause, "syscall")),
    causeHostname: safeText(Reflect.get(cause, "hostname")),
  };
  const signal = Object.values(details).filter(Boolean).join(" ");
  if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(signal)) return { ...details, category: "DNS", message: "Falha ao resolver o host do Asaas." };
  if (/CERT|TLS|SSL|SELF_SIGNED/i.test(signal)) return { ...details, category: "TLS", message: "Falha na validação TLS com o Asaas." };
  if (/ECONNREFUSED|ECONNRESET|EPIPE|SOCKET|UND_ERR_CONNECT/i.test(signal)) return { ...details, category: "SOCKET", message: "Conexão com o Asaas foi recusada ou interrompida." };
  if (/INVALID.*HEADER|HEADER.*INVALID|UND_ERR_INVALID_ARG/i.test(signal)) return { ...details, category: "HEADER", message: "Um cabeçalho HTTP foi rejeitado antes do envio." };
  if (/TIMEOUT|ABORT/i.test(signal)) return { ...details, category: "TIMEOUT", message: "A conexão com o Asaas excedeu o tempo limite." };
  if (/INVALID.*URL|ERR_INVALID_URL/i.test(signal)) return { ...details, category: "URL", message: "A URL do diagnóstico foi rejeitada antes do envio." };
  return { ...details, category: "NETWORK", message: "O runtime não conseguiu concluir a conexão externa." };
}

function validateHeaderValue(value: string | null) {
  if (!value || /[\0\r\n]/.test(value)) return false;
  try { new Headers({ access_token: value }); return true; } catch { return false; }
}

export function readAsaasRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawProvider = env.PAYMENT_PROVIDER?.trim().toLowerCase();
  const provider = rawProvider === "asaas" || rawProvider === "mock" ? rawProvider : "other";
  const rawEnvironment = env.ASAAS_ENV?.trim().toLowerCase();
  const environment = rawEnvironment === "sandbox" || rawEnvironment === "production" ? rawEnvironment : "other";
  const effectiveBaseUrl = (env.ASAAS_BASE_URL?.trim() || ASAAS_SANDBOX_URL).replace(/\/+$/, "");
  const baseUrl = ALLOWED_BASE_URLS.get(effectiveBaseUrl as typeof ASAAS_SANDBOX_URL | typeof ASAAS_PRODUCTION_URL) ?? "INVALID";
  const { key: apiKey, source: apiKeySource, reason: apiKeyReason } = resolveAsaasApiKey(env);
  const apiKeyConfigured = Boolean(apiKey);
  const apiKeyHeaderValid = validateHeaderValue(apiKey);
  const webhookTokenConfigured = configured(env.ASAAS_WEBHOOK_TOKEN);
  const expectedBase = environment === "sandbox" ? "SANDBOX" : environment === "production" ? "PRODUCTION" : null;
  let requestUrlValid = false;
  let target: AsaasDiagnosticDTO["target"] = null;
  try { const url = new URL(`${effectiveBaseUrl}/finance/balance`); requestUrlValid = url.protocol === "https:"; target = { host: url.host, path: url.pathname }; } catch { /* reported safely below */ }
  const reason = provider !== "asaas" ? "PROVIDER_INVALID" : environment === "other" ? "ENVIRONMENT_INVALID" : baseUrl === "INVALID" || baseUrl !== expectedBase ? "BASE_URL_INVALID" : !requestUrlValid ? "BASE_URL_INVALID" : apiKeyReason === "b64_invalid" ? "API_KEY_B64_INVALID" : !apiKeyConfigured ? "API_KEY_MISSING" : !apiKeyHeaderValid ? "API_KEY_HEADER_INVALID" : !webhookTokenConfigured ? "WEBHOOK_TOKEN_MISSING" : null;
  return {
    ok: false, provider, environment, baseUrl, baseUrlStatus: baseUrl === "INVALID" ? "INVALID" : "OK",
    apiKeyConfigured, apiKeySource, apiKeyReason, webhookTokenConfigured, authentication: "NOT_TESTED", httpStatus: null, checkedAt: null,
    configurationError: reason !== null, reason, category: !requestUrlValid ? "URL" : !apiKeyHeaderValid && apiKeyConfigured ? "HEADER" : null,
    target, requestUrlValid, apiKeyHeaderValid, requestAttempted: false, error: null,
    connectivity: { attempted: false, reachable: null, httpStatus: null, error: null }, apiKey, effectiveBaseUrl,
  };
}

export function publicAsaasDiagnostic(config: RuntimeConfig): AsaasDiagnosticDTO {
  const { apiKey: _apiKey, effectiveBaseUrl: _effectiveBaseUrl, ...safe } = config;
  return safe;
}

async function testHostConnectivity(config: RuntimeConfig, fetcher: typeof fetch): Promise<AsaasDiagnosticDTO["connectivity"]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const origin = new URL(config.effectiveBaseUrl).origin;
    const response = await fetcher(origin, { method: "HEAD", redirect: "manual", signal: controller.signal });
    try { await response.body?.cancel(); } catch { /* response status remains sufficient */ }
    return { attempted: true, reachable: true, httpStatus: response.status, error: null };
  } catch (error) {
    return { attempted: true, reachable: false, httpStatus: null, error: safeFetchError(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function testAsaasConnection(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<AsaasDiagnosticDTO> {
  const config = readAsaasRuntimeConfig(env);
  const checkedAt = new Date().toISOString();
  if (config.configurationError || !config.apiKey) return { ...publicAsaasDiagnostic(config), authentication: "ERROR", checkedAt };
  const connectivity = await testHostConnectivity(config, fetcher);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let request: Request;
    try {
      request = new Request(`${config.effectiveBaseUrl}/finance/balance`, {
        method: "GET", signal: controller.signal,
        headers: { accept: "application/json", "content-type": "application/json", access_token: config.apiKey, "user-agent": "BancadaSoft-Admin-Diagnostic/1.0" },
      });
    } catch (error) {
      const safeError = safeFetchError(error);
      return { ...publicAsaasDiagnostic(config), connectivity, authentication: "ERROR", checkedAt, category: safeError.category, reason: "NETWORK_ERROR", error: safeError };
    }
    try {
      const response = await fetcher(request);
      try { await response.body?.cancel(); } catch { /* response content is intentionally discarded */ }
      const ok = response.status === 200;
      return { ...publicAsaasDiagnostic(config), connectivity, ok, authentication: ok ? "ONLINE" : "ERROR", httpStatus: response.status, checkedAt, reason: ok ? null : response.status === 401 ? "AUTHENTICATION_FAILED" : "HTTP_ERROR", category: ok ? null : response.status === 401 ? "AUTH" : "HTTP", requestAttempted: true };
    } catch (error) {
      const safeError = safeFetchError(error);
      return { ...publicAsaasDiagnostic(config), connectivity, authentication: "ERROR", checkedAt, reason: safeError.category === "TIMEOUT" ? "TIMEOUT" : "NETWORK_ERROR", category: safeError.category, requestAttempted: true, error: safeError };
    }
  } finally { clearTimeout(timer); }
}
