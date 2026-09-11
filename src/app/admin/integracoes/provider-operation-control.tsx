"use client";

import { useState } from "react";

export default function ProviderOperationControl({ providerId, initialActive }: { providerId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function toggleOperation() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/providers/${providerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Não foi possível atualizar a operação.");
      setActive(result.data.active);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a operação.");
    } finally {
      setPending(false);
    }
  }

  return <div className="provider-operation-control">
    <span className={`operation-state ${active ? "operation-active" : "operation-inactive"}`}>Operação: {active ? "ATIVA" : "INATIVA"}</span>
    <button type="button" disabled={pending} onClick={toggleOperation} className={active ? "operation-disable" : "operation-enable"}>
      {pending ? "Salvando..." : active ? "Desativar operação" : "Ativar operação"}
    </button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
