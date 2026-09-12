import { ProviderIntegrationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { configuredHeartUnlocksAdapter, HeartUnlocksProviderAdapter } from "@/lib/providers/heartunlocks";

export async function heartUnlocksGatewayStatus() {
  const adapter = configuredHeartUnlocksAdapter();
  const configured = adapter instanceof HeartUnlocksProviderAdapter;
  if (!configured) {
    await prisma.provider.updateMany({ where: { code: "heartunlocks", integrationStatus: { not: ProviderIntegrationStatus.NOT_CONNECTED } }, data: { integrationStatus: ProviderIntegrationStatus.NOT_CONNECTED } });
    return { configured:false, online:false, integrationStatus:ProviderIntegrationStatus.NOT_CONNECTED, checkedAt:null as string|null };
  }
  const health = await adapter.checkConnection();
  const integrationStatus = health.connected ? ProviderIntegrationStatus.CONNECTED : ProviderIntegrationStatus.ERROR;
  await prisma.provider.updateMany({ where: { code: "heartunlocks", integrationStatus: { not: integrationStatus } }, data: { integrationStatus } });
  return { configured:true, online:health.connected, integrationStatus, checkedAt:new Date().toISOString() };
}

export async function listAdminIntegrations() {
  const [providers,settings] = await Promise.all([prisma.provider.findMany({
    include: {
      products: {
        include: { product: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { products: true, orders: true } },
    },
    orderBy: { name: "asc" },
  }),prisma.siteSettings.findUnique({where:{id:"default"},select:{providerMode:true}})]);
  return {mode:settings?.providerMode??"TEST",providers:providers.map((provider) => ({
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
      mode: link.mode,
      operational:link.active&&provider.active&&link.mode===(settings?.providerMode??"TEST"),
      product: link.product,
    })),
  }))};
}
