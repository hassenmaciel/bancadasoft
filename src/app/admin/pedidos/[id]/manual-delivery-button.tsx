"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  MANUAL_DELIVERY_REASON_MAX,
  MANUAL_DELIVERY_REASON_MIN,
} from "@/lib/manual-delivery-rules";

export default function ManualDeliveryButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const trimmed = reason.trim();
  const validReason =
    trimmed.length >= MANUAL_DELIVERY_REASON_MIN &&
    trimmed.length <= MANUAL_DELIVERY_REASON_MAX;

  async function submit() {
    if (sending || !validReason) return;
    setSending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/manual-delivery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: trimmed }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível registrar a entrega manual.");
      setConfirming(false);
      setMessage("Entrega manual registrada.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível registrar a entrega manual.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="manual-delivery admin-form compact">
      <label>
        Motivo da entrega manual
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={MANUAL_DELIVERY_REASON_MAX}
          placeholder="Ex.: acesso comprado no painel do fornecedor e entregue ao cliente pelo WhatsApp; cliente confirmou."
          disabled={sending}
        />
      </label>
      <small>
        {trimmed.length}/{MANUAL_DELIVERY_REASON_MAX} (mínimo {MANUAL_DELIVERY_REASON_MIN})
      </small>
      {confirming ? (
        <>
          <p className="security-note">
            Isso marca o pedido como entregue. Use só se o cliente já recebeu o acesso.
          </p>
          <div className="form-actions">
            <button type="button" onClick={() => setConfirming(false)} disabled={sending}>
              Cancelar
            </button>
            <button type="button" className="admin-primary" onClick={submit} disabled={sending}>
              {sending ? "Registrando…" : "Confirmar entrega manual"}
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button
            type="button"
            className="admin-primary"
            onClick={() => setConfirming(true)}
            disabled={!validReason}
          >
            Registrar entrega manual
          </button>
        </div>
      )}
      {message && <p className="form-message">{message}</p>}
    </div>
  );
}
