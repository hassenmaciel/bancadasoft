import type { OrderDTO } from "./dto";
import { isActiveCheckoutOrder } from "./order-polling";

// Janela em que um VISITANTE ainda vê a entrega reabrir sozinha no checkout
// do produto. Cliente logado nunca vê (tem "Meus pedidos").
export const GUEST_DELIVERED_RESTORE_MINUTES = 30;

export type RestoreDecision = "restore" | "forget";

// Momento da entrega = primeiro evento DELIVERED do pedido (os três caminhos
// de entrega gravam esse evento visível ao cliente na mesma transação).
export function deliveredAtFromEvents(
  events: ReadonlyArray<{ status: string; createdAt: Date | string }> | null | undefined,
): Date | null {
  let first: Date | null = null;
  for (const event of events ?? []) {
    if (event.status !== "DELIVERED") continue;
    const at = new Date(event.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    if (!first || at < first) first = at;
  }
  return first;
}

// "Agora" pelo relógio do servidor (payment.serverTime da mesma resposta);
// só sem ele cai no relógio do cliente.
export function restoreNow(order: Pick<OrderDTO, "payment">): Date {
  const serverTime = order.payment?.serverTime ? new Date(order.payment.serverTime) : null;
  return serverTime && !Number.isNaN(serverTime.getTime()) ? serverTime : new Date();
}

// Decide se um pedido salvo neste navegador volta a abrir no checkout.
// Ativo (PIX pendente/expirado recuperável, PAID, PROCESSING...) → sempre
// "restore", independentemente de login e de datas. DELIVERED → só visitante,
// dentro da janela. Todo o resto → "forget".
export function shouldRestoreOrder({
  order,
  deliveredAt,
  now,
  viewerLoggedIn,
  windowMinutes = GUEST_DELIVERED_RESTORE_MINUTES,
}: {
  order: OrderDTO;
  deliveredAt: Date | null;
  now: Date;
  viewerLoggedIn: boolean;
  windowMinutes?: number;
}): RestoreDecision {
  if (isActiveCheckoutOrder(order)) return "restore";
  if (order.status !== "DELIVERED") return "forget";
  if (viewerLoggedIn || !deliveredAt) return "forget";
  const elapsed = now.getTime() - deliveredAt.getTime();
  return elapsed >= 0 && elapsed <= windowMinutes * 60_000 ? "restore" : "forget";
}
