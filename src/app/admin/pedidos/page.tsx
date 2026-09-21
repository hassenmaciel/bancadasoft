import { FulfillmentStatus, OrderStatus, PaymentStatus } from "@prisma/client";
import { ATTENTION_LABELS, parseAttentionKey } from "@/lib/admin-attention";
import { searchAdminOrders } from "@/lib/admin-orders";
import OrderList from "./order-list";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ attention?: string | string[] }> }) {
  const { attention: rawAttention } = await searchParams;
  // Valor inválido (ou repetido) é ignorado: lista sem filtro.
  const attention = parseAttentionKey(rawAttention);
  return <OrderList
    key={attention ?? "ALL"}
    initialOrders={await searchAdminOrders({ attention })}
    initialAttention={attention ?? null}
    attentionLabel={attention ? ATTENTION_LABELS[attention] : null}
    orderStatuses={Object.values(OrderStatus)}
    paymentStatuses={Object.values(PaymentStatus)}
    fulfillmentStatuses={Object.values(FulfillmentStatus)}
  />;
}
