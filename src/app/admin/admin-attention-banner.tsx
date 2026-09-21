import Link from "next/link";
import { attentionSummary, getAttentionCounts } from "@/lib/admin-attention";

// Faixa de aviso do admin. Nunca pode quebrar nem atrasar a página: renderizada
// dentro de <Suspense fallback={null}> no layout e, se a consulta falhar,
// devolve null. getAttentionCounts usa React.cache (dedupa com o dashboard).
export async function loadAttentionAlerts() {
  try {
    return attentionSummary(await getAttentionCounts());
  } catch {
    return [];
  }
}

export function AttentionBannerView({ alerts }: { alerts: ReturnType<typeof attentionSummary> }) {
  if (alerts.length === 0) return null;
  return (
    <div className="attention-banner" role="status">
      {alerts.map((alert) => (
        <p key={alert.key}>
          <b>{alert.count}</b> {alert.label}
          <Link href={alert.href}>Ver pedidos</Link>
        </p>
      ))}
    </div>
  );
}

export default async function AdminAttentionBanner() {
  return <AttentionBannerView alerts={await loadAttentionAlerts()} />;
}
