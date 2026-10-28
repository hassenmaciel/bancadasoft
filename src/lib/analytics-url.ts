// Filtro do Vercel Web Analytics (beforeSend): nada do /admin, sem id de pedido
// no caminho e sem query/fragmento (token de redefinição vem em #token=).
const ADMIN_PATH = /^\/admin(\/|$)/i;
const ORDER_PATH = /^\/(acompanhar|meus-pedidos)\/[^/]+/;
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:/i;

export function sanitizeAnalyticsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://relative.invalid");
  } catch {
    return null;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (ADMIN_PATH.test(pathname)) return null;
  const path = parsed.pathname.replace(ORDER_PATH, "/$1/[id]");
  return ABSOLUTE_URL.test(url) ? `${parsed.origin}${path}` : path;
}

export function analyticsBeforeSend<T extends { url: string }>(event: T): T | null {
  const url = sanitizeAnalyticsUrl(event.url);
  return url === null ? null : { ...event, url };
}
