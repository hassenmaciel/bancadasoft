"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RetryButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [hint, setHint] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/orders/${orderId}/retry`)
      .then((r) => r.json())
      .then((x) => {
        setAllowed(Boolean(x.data?.allowed));
        setHint(typeof x.data?.message === "string" ? x.data.message : "");
      })
      .catch(() => setAllowed(false));
  }, [orderId]);

  async function retry() {
    if (!allowed) return;
    setLoading(true);
    setMessage("");
    const response = await fetch(`/api/admin/orders/${orderId}/retry`, {
      method: "POST",
    });
    const result = await response.json();
    setLoading(false);
    if (!response.ok) {
      setMessage("Não foi possível concluir a recuperação. Tente novamente ou revise o pedido.");
      return;
    }
    const status = result.data?.status;
    setMessage(
      status === "COMPLETED"
        ? "Liberação recuperada com sucesso."
        : status === "ALREADY_DELIVERED"
          ? "Este pedido já está entregue."
          : "Estamos verificando com o provider. Tente novamente em instantes.",
    );
    router.refresh();
  }

  if (!allowed) return null;
  return (
    <div className="retry-action">
      {hint && <small>{hint}</small>}
      <button className="admin-primary" onClick={retry} disabled={loading}>
        {loading ? "Executando..." : "Recuperar liberação"}
      </button>
      {message && <small>{message}</small>}
    </div>
  );
}
