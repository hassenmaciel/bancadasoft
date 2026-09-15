import { FulfillmentStatus, OrderStatus, PaymentStatus } from "@prisma/client";
import { searchAdminOrders } from "@/lib/admin-orders";
import OrderList from "./order-list";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  return <OrderList
    initialOrders={await searchAdminOrders({})}
    orderStatuses={Object.values(OrderStatus)}
    paymentStatuses={Object.values(PaymentStatus)}
    fulfillmentStatuses={Object.values(FulfillmentStatus)}
  />;
}
