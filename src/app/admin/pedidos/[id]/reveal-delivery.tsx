"use client";
import { useState } from "react";
import CredentialDelivery from "@/components/credential-delivery";
import type { DeliveryDTO } from "@/lib/dto";

export default function RevealDelivery({
  orderId,
  hasDelivery,
}: {
  orderId: string;
  hasDelivery: boolean;
}) {
  const [delivery, setDelivery] = useState<DeliveryDTO | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function reveal() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/delivery`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Não foi possível carregar a entrega.");
      setDelivery(body.data.delivery);
      setRevealed(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível carregar a entrega.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (!hasDelivery)
    return <p className="detail-empty">Nenhuma entrega disponível.</p>;
  if (!revealed)
    return (
      <>
        <button
          type="button"
          className="admin-primary"
          onClick={reveal}
          disabled={loading}
        >
          {loading ? "Carregando…" : "Exibir dados da entrega"}
        </button>
        {error && <p className="form-message">{error}</p>}
      </>
    );
  return delivery ? (
    <CredentialDelivery {...delivery} />
  ) : (
    <p className="detail-empty">Entrega ainda não disponível.</p>
  );
}
