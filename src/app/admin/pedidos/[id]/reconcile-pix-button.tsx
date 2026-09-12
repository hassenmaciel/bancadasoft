"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import "./reconcile-pix.css";

export default function ReconcilePixButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function reconcile() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/reconcile-pix`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          payload?.error ?? "Não foi possível recuperar o PIX existente.",
        );
      setMessage("PIX reconciliado com a cobrança existente.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível recuperar o PIX existente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pix-reconcile-action">
      <button type="button" onClick={reconcile} disabled={busy}>
        {busy ? "RECUPERANDO PIX..." : "RECUPERAR PIX EXISTENTE"}
      </button>
      {message && <p aria-live="polite">{message}</p>}
    </div>
  );
}
