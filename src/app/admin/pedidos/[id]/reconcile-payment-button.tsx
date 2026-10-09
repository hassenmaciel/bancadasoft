"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_RECONCILE_CONFIRM_TEXT } from "@/lib/payment-reconcile-rules";
import "./reconcile-pix.css";

export default function ReconcilePaymentButton({ orderId }: { orderId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function reconcile() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/reconcile-payment`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error ?? "Não foi possível reconciliar o pagamento.");
      setConfirming(false);
      setMessage(
        payload?.data?.fulfillment === "FAILED"
          ? "Pagamento confirmado, mas a entrega falhou. Veja o histórico do pedido."
          : "Pagamento confirmado pelo Asaas e entrega iniciada.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível reconciliar o pagamento.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pix-reconcile-action">
      {confirming ? (
        <>
          <p>{PAYMENT_RECONCILE_CONFIRM_TEXT}</p>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
            CANCELAR
          </button>{" "}
          <button type="button" onClick={reconcile} disabled={busy}>
            {busy ? "CONSULTANDO ASAAS..." : "CONFIRMAR RECONCILIAÇÃO"}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          RECONCILIAR PAGAMENTO COM O ASAAS
        </button>
      )}
      {message && <p aria-live="polite">{message}</p>}
    </div>
  );
}
