-- Provider catalog entries may exist before a BancadaSoft commercial product is linked.
ALTER TABLE "ProviderProduct" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "ProviderProduct" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "ProviderProduct" ADD COLUMN "syncStatus" TEXT;

DROP INDEX "ProviderProduct_providerId_productId_externalProductId_key";
CREATE UNIQUE INDEX "ProviderProduct_providerId_externalProductId_key"
ON "ProviderProduct"("providerId", "externalProductId");
