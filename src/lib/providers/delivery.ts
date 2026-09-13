export type NormalizedDelivery = {
  kind: string;
  deliveryType: "CREDENTIALS" | "LICENSE" | "CODE" | "TEXT" | "MULTI_FIELD";
  title: string;
  deliveryFields: Array<{ key: string; label: string; value: string; sensitive: boolean }>;
  username?: string;
  password?: string;
  credential?: string;
  instructions?: string;
};

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
export function normalizeProviderReplay(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&([a-z]+|#39);/gi, (match, key: string) => entities[key.toLowerCase()] ?? match)
    .replace(/[\t ]+\n/g, "\n")
    .trim();
}

const keyFor = (label: string) => {
  const key = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (["user", "user_name", "username", "login"].includes(key)) return "username";
  if (["pass", "password", "senha"].includes(key)) return "password";
  if (/license|licenca|licence|activation_key/.test(key)) return "license";
  if (/code|codigo|key|chave/.test(key)) return "code";
  return key || "value";
};

export function parseProviderDelivery(text: string | null, product: { name: string }, expected?: string): NormalizedDelivery | null {
  if (!text) return null;
  const normalized = normalizeProviderReplay(text);
  if (!normalized) return null;
  const fields = normalized.split("\n").flatMap((line) => {
    const match = line.match(/^\s*([^:=<>]{1,80})\s*(?:=>|:|=)\s*(.+?)\s*$/);
    if (!match) return [];
    const key = keyFor(match[1]);
    return [{ key, label: match[1].trim(), value: match[2].trim(), sensitive: /password|senha|pass|license|licen|code|codigo|key|chave|token/.test(key) }];
  }).filter((field) => field.value);
  const username = fields.find((field) => field.key === "username")?.value;
  const password = fields.find((field) => field.key === "password")?.value;
  const expectedCredential = expected === "LICENSE" || expected === "CODE" ? expected : null;
  let deliveryType: NormalizedDelivery["deliveryType"];
  if (username && password) deliveryType = "CREDENTIALS";
  else if (fields.some((field) => field.key === "license")) deliveryType = "LICENSE";
  else if (fields.some((field) => field.key === "code")) deliveryType = "CODE";
  else if (fields.length > 1) deliveryType = "MULTI_FIELD";
  else if (expectedCredential && fields.length <= 1) deliveryType = expectedCredential;
  else deliveryType = "TEXT";
  const deliveryFields = fields.length
    ? fields
    : [{
        key: deliveryType === "CODE" ? "code" : deliveryType === "LICENSE" ? "license" : "text",
        label: deliveryType === "CODE" ? "Código" : deliveryType === "LICENSE" ? "Licença" : "Resultado",
        value: normalized,
        sensitive: deliveryType !== "TEXT",
      }];
  return {
    kind: deliveryType === "CREDENTIALS" ? "credentials" : "provider-delivery",
    deliveryType,
    title: product.name,
    deliveryFields,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(deliveryType === "LICENSE" || deliveryType === "CODE" ? { credential: deliveryFields[0]?.value } : {}),
    instructions: "Use os dados entregues somente nas condições do produto contratado.",
  };
}
