"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import CredentialDelivery from "@/components/credential-delivery";
import type { DeliveryDTO } from "@/lib/dto";

type State = {
  number: string;
  status: string;
  products: string[];
  paymentStatus: string | null;
  delivery: DeliveryDTO | null;
};
const message = (state: State) =>
  state.delivery
    ? "Seu acesso foi liberado."
    : state.paymentStatus === "PAID"
      ? "Pagamento confirmado. Estamos liberando seu acesso."
      : "Aguardando pagamento";

export default function GuestDelivery({ orderId }: { orderId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let token = localStorage.getItem(`bancadasoft:delivery:${orderId}`);
      if (!token && window.location.hash.startsWith("#token=")) {
        token = decodeURIComponent(window.location.hash.slice(7));
        localStorage.setItem(`bancadasoft:delivery:${orderId}`, token);
        history.replaceState(null, "", window.location.pathname);
      }
      if (!token) {
        setError(
          "O acesso seguro deste pedido não está disponível neste navegador.",
        );
        return;
      }
      const response = await fetch(`/api/orders/${orderId}/delivery`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Não foi possível consultar o pedido.");
        return;
      }
      if (stopped) return;
      setState(payload.data);
      if (
        !payload.data.delivery &&
        payload.data.status !== "FAILED" &&
        payload.data.status !== "CANCELLED"
      )
        timer = setTimeout(load, 3000);
    };
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderId]);
  return (
    <main className="guest-delivery-page">
      <section className="guest-delivery-card">
        <span>BANCADASOFT</span>
        <h1>{state ? message(state) : "Acompanhar pedido"}</h1>
        {state && (
          <>
            <p>Pedido {state.number}</p>
            <p>{state.products.join(", ")}</p>
            {state.delivery && <CredentialDelivery {...state.delivery} />}
          </>
        )}
        {error && (
          <p className="guest-delivery-error" role="alert">
            {error}
          </p>
        )}
        <Link href="/">Voltar à loja</Link>
      </section>
    </main>
  );
}
