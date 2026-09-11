import { ProductStatus } from "@prisma/client";

export function commercialMetrics(priceCents: number, costCents?: number | null) {
  const cost = Math.max(0, costCents ?? 0);
  const profitCents = priceCents - cost;
  return { profitCents, marginPercent: priceCents > 0 ? (profitCents / priceCents) * 100 : 0 };
}

export const isPublishedForStore = (status: ProductStatus, available: boolean) =>
  status === ProductStatus.PUBLISHED && available;

export const canChangeLastAdmin = (adminCount: number, currentRole: string, nextRole: string) =>
  !(currentRole === "ADMIN" && nextRole !== "ADMIN" && adminCount <= 1);

export const publicSettings = <T extends { businessName: string; slogan: string; domain: string; supportWhatsapp: string | null; supportEmail: string | null; supportText: string | null; maintenanceEnabled: boolean; maintenanceMessage: string }>(settings: T) => ({
  businessName: settings.businessName,
  slogan: settings.slogan,
  domain: settings.domain,
  supportWhatsapp: settings.supportWhatsapp,
  supportEmail: settings.supportEmail,
  supportText: settings.supportText,
  maintenanceEnabled: settings.maintenanceEnabled,
  maintenanceMessage: settings.maintenanceMessage,
});
