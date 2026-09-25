import { createHash, randomBytes } from "node:crypto";

// Chave da API de revenda: 32 bytes aleatórios (crypto), exibida em texto puro
// UMA única vez na emissão. O banco guarda só o SHA-256 (hex) em
// ResellerApiKey.tokenHash. O prefixo "bsr_" só facilita reconhecer a chave
// (por exemplo em um vazamento); não carrega nenhum dado.
export const RESELLER_KEY_PREFIX = "bsr_";

export function hashResellerApiKey(plaintext: string) {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateResellerApiKey(random: (size: number) => Buffer = randomBytes) {
  const plaintext = `${RESELLER_KEY_PREFIX}${random(32).toString("base64url")}`;
  return { plaintext, tokenHash: hashResellerApiKey(plaintext) };
}

// Extrai a chave de "Authorization: Bearer <chave>". Retorna null para
// qualquer formato inesperado (a rota responde 401 sem detalhar o motivo).
export function bearerKey(authorizationHeader: string | null) {
  const prefix = "Bearer ";
  if (!authorizationHeader?.startsWith(prefix)) return null;
  const key = authorizationHeader.slice(prefix.length).trim();
  if (!key.startsWith(RESELLER_KEY_PREFIX) || key.length > 200) return null;
  return key;
}
