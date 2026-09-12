import { PrismaClient } from "@prisma/client";
import { classifyProviderProduct } from "../src/lib/providers/automation.ts";

const prisma = new PrismaClient();
try {
  const products = await prisma.providerProduct.findMany({
    include: { provider: { select: { code: true } }, orders: { where: { status: "COMPLETED" }, select: { id: true }, take: 1 } },
  });
  const classified = products.map((product) => ({ product, automation: classifyProviderProduct({ providerCode: product.provider.code, label: product.label, providerCostCents: product.providerCostCents, metadata: product.metadata }) }));
  const validatedSignatures = new Set(classified.filter(({ product }) => product.orders.length > 0).map(({ automation }) => automation.contractSignature));
  for (let offset = 0; offset < classified.length; offset += 100) {
    await prisma.$transaction(classified.slice(offset, offset + 100).map(({ product, automation }) => prisma.providerProduct.update({
      where: { id: product.id },
      data: {
        automationClass: automation.automationClass,
        technicalEligibility: automation.technicalEligibility,
        expectedDeliveryType: automation.expectedDeliveryType,
        contractSignature: automation.contractSignature,
        fieldSchema: automation.fieldSchema,
        homologationStatus: product.orders.length > 0 ? "PRODUCT_VALIDATED" : validatedSignatures.has(automation.contractSignature) ? "CLASS_VALIDATED" : "UNTESTED",
      },
    })));
  }
  const counts = classified.reduce((result, { automation }) => ({ ...result, [automation.automationClass]: (result[automation.automationClass] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ total: products.length, counts, validatedContracts: validatedSignatures.size }));
} finally {
  await prisma.$disconnect();
}
