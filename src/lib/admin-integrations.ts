import { prisma } from "@/lib/prisma";
import { configuredHeartUnlocksAdapter, HeartUnlocksProviderAdapter } from "@/lib/providers/heartunlocks";

export async function heartUnlocksGatewayStatus() {
  const adapter = configuredHeartUnlocksAdapter();
  const configured = adapter instanceof HeartUnlocksProviderAdapter;
  if (!configured) return { configured:false, online:false, checkedAt:null as string|null };
  const health = await adapter.checkConnection();
  return { configured:true, online:health.connected, checkedAt:new Date().toISOString() };
}

export async function listAdminIntegrations() {
  const providers = await prisma.provider.findMany({
    include: {
      products: {
        include: { product: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { products: true, orders: true } },
    },
    orderBy: { name: "asc" },
  });
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    code: provider.code,
    active: provider.active,
    apiBaseUrl: provider.apiBaseUrl,
    integrationStatus: provider.integrationStatus,
    productCount: provider._count.products,
    orderCount: provider._count.orders,
    updatedAt: provider.updatedAt.toISOString(),
    products: provider.products.map((link) => ({
      id: link.id,
      externalProductId: link.externalProductId,
      label: link.label,
      providerCostCents: link.providerCostCents,
      currency: link.currency,
      active: link.active,
      product: link.product,
    })),
  }));
}
