"use client";

import { useState } from "react";

type Result = { found: number; created: number; updated: number; unlinked: number; syncedAt: string };

export default function ProviderCatalogSync({ providerId }: { providerId: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  async function synchronize() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/admin/providers/${providerId}/sync`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao sincronizar o catálogo.");
      setResult(payload.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao sincronizar o catálogo."); }
    finally { setPending(false); }
  }
  return <div className="provider-sync-control">
    <button className="admin-primary" type="button" onClick={synchronize} disabled={pending}>{pending ? "Sincronizando..." : "Sincronizar HeartUnlocks"}</button>
    {result && <small>Encontrados: {result.found} · atualizados: {result.updated} · não vinculados: {result.unlinked} · em {new Date(result.syncedAt).toLocaleString("pt-BR")}</small>}
    {error && <small className="sync-error" role="alert">{error}</small>}
  </div>;
}
