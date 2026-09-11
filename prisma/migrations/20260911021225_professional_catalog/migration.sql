-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('IMMEDIATE', 'AUTOMATIC', 'MANUAL', 'ON_REQUEST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductType" ADD VALUE 'ACTIVATION';
ALTER TYPE "ProductType" ADD VALUE 'IMEI_SN';
ALTER TYPE "ProductType" ADD VALUE 'FILE';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "deliveryEstimate" TEXT,
ADD COLUMN     "deliveryType" "DeliveryType" NOT NULL DEFAULT 'AUTOMATIC',
ADD COLUMN     "longDescription" TEXT,
ADD COLUMN     "searchTerms" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Product_status_available_sortOrder_idx" ON "Product"("status", "available", "sortOrder");

-- CreateIndex
CREATE INDEX "Product_categoryId_status_idx" ON "Product"("categoryId", "status");

-- CreateIndex
CREATE INDEX "Product_brandId_status_idx" ON "Product"("brandId", "status");
