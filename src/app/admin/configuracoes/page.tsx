import { prisma } from "@/lib/prisma";
import SettingsForm from "./settings-form";
import PricingSettingsForm from "./pricing-settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, pricing] = await Promise.all([
    prisma.siteSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } }),
    prisma.pricingConfiguration.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
      include: { groupRules: { orderBy: { productType: "asc" } } },
    }),
  ]);
  return <>
    <header className="admin-heading"><div><small>OPERAÇÃO</small><h1>Configurações</h1><p>Informações públicas, disponibilidade e precificação da loja.</p></div></header>
    <SettingsForm settings={settings} />
    <PricingSettingsForm initial={{
      automaticEnabled: pricing.automaticEnabled,
      exchangeRateMicros: pricing.exchangeRateMicros,
      exchangeBufferBps: pricing.exchangeBufferBps,
      targetMarginBps: pricing.targetMarginBps,
      minimumProfitCents: pricing.minimumProfitCents,
      asaasFeeType: pricing.asaasFeeType,
      asaasFixedFeeCents: pricing.asaasFixedFeeCents,
      asaasPercentBps: pricing.asaasPercentBps,
      roundingMode: pricing.roundingMode,
      minimumPriceCents: pricing.minimumPriceCents,
      groupRules: pricing.groupRules.map((rule) => ({
        productType: rule.productType,
        exchangeBufferBps: rule.exchangeBufferBps,
        targetMarginBps: rule.targetMarginBps,
        minimumProfitCents: rule.minimumProfitCents,
        minimumPriceCents: rule.minimumPriceCents,
        roundingMode: rule.roundingMode,
        additionalFeeCents: rule.additionalFeeCents,
        additionalFeeBps: rule.additionalFeeBps,
      })),
    }} />
  </>;
}
