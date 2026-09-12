import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const provider = await prisma.provider.findUnique({ where: { code: "heartunlocks" }, select: { id: true } });
  if (!provider) throw new Error("HEARTUNLOCKS_PROVIDER_NOT_FOUND");
  const [counts, signatures, referenceProducts] = await Promise.all([
    prisma.providerProduct.groupBy({ by: ["automationClass"], where: { providerId: provider.id }, _count: { _all: true } }),
    prisma.providerProduct.groupBy({ by: ["contractSignature"], where: { providerId: provider.id, contractSignature: { not: null } }, _count: { _all: true }, orderBy: { _count: { contractSignature: "desc" } } }),
    prisma.providerProduct.findMany({ where: { providerId: provider.id, externalProductId: { in: ["2194", "2337"] } }, select: { externalProductId: true, contractSignature: true, automationClass: true, homologationStatus: true } }),
  ]);
  const referenceSignature = referenceProducts.find((item) => item.externalProductId === "2194")?.contractSignature;
  const referenceGroup = referenceSignature ? await prisma.providerProduct.count({ where: { providerId: provider.id, contractSignature: referenceSignature } }) : 0;
  console.log(JSON.stringify({ total: counts.reduce((sum, row) => sum + row._count._all, 0), counts: Object.fromEntries(counts.map((row) => [row.automationClass, row._count._all])), uniqueSignatures: signatures.length, largestGroup: signatures[0]?._count._all ?? 0, unlockToolAmtGroup: referenceGroup, referenceProducts }));
} finally { await prisma.$disconnect(); }
