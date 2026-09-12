import { PricingFeeType, PricingRoundingMode, ProductType } from "@prisma/client";
import { z } from "zod";

const bps = z.number().int().min(0).max(9_999);
const optionalBps = bps.nullable();
const cents = z.number().int().min(0).max(1_000_000_000);

export const pricingConfigurationSchema = z.object({
  automaticEnabled: z.boolean(),
  exchangeRateMicros: z.number().int().min(1).max(100_000_000).nullable(),
  exchangeBufferBps: bps,
  targetMarginBps: bps,
  minimumProfitCents: cents,
  asaasFeeType: z.nativeEnum(PricingFeeType),
  asaasFixedFeeCents: cents,
  asaasPercentBps: bps,
  roundingMode: z.nativeEnum(PricingRoundingMode),
  minimumPriceCents: cents,
  groupRules: z.array(z.object({
    productType: z.nativeEnum(ProductType),
    exchangeBufferBps: optionalBps,
    targetMarginBps: optionalBps,
    minimumProfitCents: cents.nullable(),
    minimumPriceCents: cents.nullable(),
    roundingMode: z.nativeEnum(PricingRoundingMode).nullable(),
    additionalFeeCents: cents.nullable(),
    additionalFeeBps: optionalBps,
  })).max(Object.values(ProductType).length),
}).superRefine((value, context) => {
  if (value.automaticEnabled && !value.exchangeRateMicros) {
    context.addIssue({ code: "custom", path: ["exchangeRateMicros"], message: "Informe o câmbio antes de ativar o cálculo automático." });
  }
  if (value.asaasPercentBps + value.targetMarginBps >= 10_000) {
    context.addIssue({ code: "custom", path: ["targetMarginBps"], message: "Margem e taxa percentual devem totalizar menos de 100%." });
  }
});

export type PricingConfigurationInput = z.infer<typeof pricingConfigurationSchema>;
