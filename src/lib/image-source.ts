// Imagens públicas do Storage do Supabase passam pelo otimizador do Next
// (ver images.remotePatterns em next.config.ts). Qualquer outra origem — por
// exemplo uma URL externa digitada no admin — continua sem otimização, como antes,
// para não quebrar a renderização com "hostname not configured".
export function isOptimizableImage(url: string | null | undefined) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname) && parsed.pathname.startsWith("/storage/v1/object/public/");
  } catch {
    return false;
  }
}
