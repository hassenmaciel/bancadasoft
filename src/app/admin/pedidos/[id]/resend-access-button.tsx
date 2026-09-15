"use client";
import { useState } from "react";

export default function ResendAccessButton({
  orderId,
  disabled,
}: {
  orderId: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");

  async function resend() {
    if (state === "sending") return;
    setState("sending");
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/resend`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível reenviar o acesso.");
      setState("sent");
      setMessage(
        body.data.status === "DUPLICATE"
          ? "Reenvio já solicitado há poucos segundos. Aguarde antes de tentar novamente."
          : "Acesso reenviado com sucesso.",
      );
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível reenviar o acesso.",
      );
    }
  }

  return (
    <div className="resend-access">
      <button
        type="button"
        className="admin-primary"
        onClick={resend}
        disabled={disabled || state === "sending"}
      >
        {state === "sending" ? "Reenviando…" : "Reenviar acesso"}
      </button>
      {message && (
        <p className={state === "error" ? "form-message" : "detail-empty"}>
          {message}
        </p>
      )}
    </div>
  );
}
