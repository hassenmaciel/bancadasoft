import { prisma } from "@/lib/prisma";
import { adminOrderDto, adminOrderInclude } from "@/lib/admin-order";

export async function listAdminOrders() {
  const orders = await prisma.order.findMany({ take: 100, include: adminOrderInclude, orderBy: { createdAt: "desc" } });
  return orders.map(adminOrderDto);
}

export async function getAdminOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id }, include: adminOrderInclude });
  return order ? adminOrderDto(order) : null;
}
