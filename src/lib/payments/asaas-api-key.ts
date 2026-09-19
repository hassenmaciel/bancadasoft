export type AsaasApiKeyResolution = {
  key: string | null;
  source: "b64" | "plain" | "none";
  reason: "ok" | "b64_invalid" | "missing";
};

// ASAAS_API_KEY_B64 wins over ASAAS_API_KEY. A present-but-invalid B64 value never falls back.
export function resolveAsaasApiKey(env: Record<string, string | undefined> = process.env): AsaasApiKeyResolution {
  const encoded = env.ASAAS_API_KEY_B64;
  if (encoded !== undefined && encoded.trim() !== "") {
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    if (!decoded || /[\u0000-\u001f\u007f]/.test(decoded)) return { key: null, source: "b64", reason: "b64_invalid" };
    return { key: decoded, source: "b64", reason: "ok" };
  }
  const plain = env.ASAAS_API_KEY?.trim();
  if (plain) return { key: plain, source: "plain", reason: "ok" };
  return { key: null, source: "none", reason: "missing" };
}
