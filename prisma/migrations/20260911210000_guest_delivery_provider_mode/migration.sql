CREATE TYPE "ProviderMode" AS ENUM ('TEST', 'REAL');

ALTER TABLE "SiteSettings" ADD COLUMN "providerMode" "ProviderMode" NOT NULL DEFAULT 'TEST';
ALTER TABLE "ProviderProduct" ADD COLUMN "mode" "ProviderMode" NOT NULL DEFAULT 'REAL';
UPDATE "ProviderProduct" pp SET "mode" = 'TEST' FROM "Provider" p WHERE pp."providerId" = p."id" AND p."code" = 'mock-sandbox';

ALTER TABLE "Order" ADD COLUMN "deliveryTokenHash" TEXT,
ADD COLUMN "deliveryTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "deliveryTokenRevokedAt" TIMESTAMP(3),
ADD COLUMN "deliveryNotifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Order_deliveryTokenHash_key" ON "Order"("deliveryTokenHash");

CREATE TABLE "DeliveryAccessAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "successful" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryAccessAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DeliveryAccessAttempt_orderId_fingerprint_createdAt_idx" ON "DeliveryAccessAttempt"("orderId", "fingerprint", "createdAt");
ALTER TABLE "DeliveryAccessAttempt" ADD CONSTRAINT "DeliveryAccessAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
