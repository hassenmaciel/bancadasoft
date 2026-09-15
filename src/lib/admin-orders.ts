import { prisma } from "./prisma";
import {
  adminOrderDto,
  adminOrderInclude,
  adminOrderListDto,
  adminOrderListSelect,
} from "./admin-order";
import {
  buildAdminOrderSearchWhere,
  type AdminOrderSearchFilters,
} from "./admin-order-search";

export async function listAdminOrders() {
  const orders = await prisma.order.findMany({ take: 100, include: adminOrderInclude, orderBy: { createdAt: "desc" } });
  return orders.map(adminOrderDto);
}

export async function getAdminOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include: adminOrderInclude });
  return order ? adminOrderDto(order) : null;
}

export async function searchAdminOrders(filters: AdminOrderSearchFilters) {
  const orders = await prisma.order.findMany({
    where: buildAdminOrderSearchWhere(filters),
    select: adminOrderListSelect,
    take: 100,
    orderBy: { createdAt: "desc" },
  });
  return orders.map(adminOrderListDto);
}
