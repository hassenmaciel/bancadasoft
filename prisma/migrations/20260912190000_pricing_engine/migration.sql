-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('AUTO_GLOBAL', 'AUTO_GROUP', 'MANUAL');

-- CreateEnum
CREATE TYPE "PricingStatus" AS ENUM ('AUTO_OK', 'MANUAL', 'NEEDS_REVIEW', 'NO_COST', 'INVALID_CONFIG');

-- CreateEnum
CREATE TYPE "PricingFeeType" AS ENUM ('FIXED', 'PERCENTAGE', 'COMBINED');

-- CreateEnum
CREATE TYPE "PricingRoundingMode" AS ENUM ('NONE', 'X_90', 'X_99', 'NEAREST_1', 'NEAREST_5');

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "pricingMode" "PricingMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "manualPriceCents" INTEGER,
ADD COLUMN "suggestedPriceCents" INTEGER,
ADD COLUMN "pricingStatus" "PricingStatus" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "pricingComputedAt" TIMESTAMP(3);

-- Existing commercial prices are explicit manual overrides and must be preserved.
UPDATE "Product"
SET "manualPriceCents" = "priceCents",
    "pricingStatus" = 'MANUAL';

-- CreateTable
CREATE TABLE "PricingConfiguration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "automaticEnabled" BOOLEAN NOT NULL DEFAULT false,
    "exchangeRateMicros" INTEGER,
    "exchangeBufferBps" INTEGER NOT NULL DEFAULT 0,
    "targetMarginBps" INTEGER NOT NULL DEFAULT 0,
    "minimumProfitCents" INTEGER NOT NULL DEFAULT 0,
    "asaasFeeType" "PricingFeeType" NOT NULL DEFAULT 'FIXED',
    "asaasFixedFeeCents" INTEGER NOT NULL DEFAULT 0,
    "asaasPercentBps" INTEGER NOT NULL DEFAULT 0,
    "roundingMode" "PricingRoundingMode" NOT NULL DEFAULT 'NONE',
    "minimumPriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingGroupRule" (
    "id" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL DEFAULT 'default',
    "productType" "ProductType" NOT NULL,
    "exchangeBufferBps" INTEGER,
    "targetMarginBps" INTEGER,
    "minimumProfitCents" INTEGER,
    "minimumPriceCents" INTEGER,
    "roundingMode" "PricingRoundingMode",
    "additionalFeeCents" INTEGER,
    "additionalFeeBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingGroupRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingGroupRule_configurationId_productType_key"
ON "PricingGroupRule"("configurationId", "productType");

-- CreateIndex
CREATE INDEX "PricingGroupRule_productType_idx" ON "PricingGroupRule"("productType");

-- AddForeignKey
ALTER TABLE "PricingGroupRule"
ADD CONSTRAINT "PricingGroupRule_configurationId_fkey"
FOREIGN KEY ("configurationId") REFERENCES "PricingConfiguration"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Safe default: pricing remains disabled until an administrator configures it.
INSERT INTO "PricingConfiguration" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
