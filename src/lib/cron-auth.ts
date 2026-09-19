import { timingSafeEqual } from "node:crypto";

// Autenticação server-to-server do scheduler externo (Supabase Cron via
// pg_net): envia `Authorization: Bearer <CRON_SECRET>`. O mesmo CRON_SECRET
// existe no Vercel Production (validação) e no Supabase Vault (envio). Esta
// função nunca configura produção sozinha.
export function validateCronSecret(
  authorizationHeader: string | null,
  expected = process.env.CRON_SECRET,
) {
  if (!expected) return false;
  const prefix = "Bearer ";
  if (!authorizationHeader || !authorizationHeader.startsWith(prefix)) return false;
  const received = authorizationHeader.slice(prefix.length);
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
