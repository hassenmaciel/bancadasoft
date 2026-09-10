-- CreateEnum
CREATE TYPE "ProviderIntegrationStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ProviderOrderStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "apiBaseUrl" TEXT,
    "integrationStatus" "ProviderIntegrationStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderProduct" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "label" TEXT,
    "providerCostCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderOrder" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerProductId" TEXT,
    "orderId" TEXT NOT NULL,
    "fulfillmentId" TEXT,
    "externalOrderId" TEXT,
    "status" "ProviderOrderStatus" NOT NULL DEFAULT 'QUEUED',
    "costCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "requestReference" TEXT,
    "responseReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Provider_code_key" ON "Provider"("code");

-- CreateIndex
CREATE INDEX "ProviderProduct_productId_active_idx" ON "ProviderProduct"("productId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderProduct_providerId_productId_externalProductId_key" ON "ProviderProduct"("providerId", "productId", "externalProductId");

-- CreateIndex
CREATE INDEX "ProviderOrder_orderId_status_idx" ON "ProviderOrder"("orderId", "status");

-- CreateIndex
CREATE INDEX "ProviderOrder_fulfillmentId_idx" ON "ProviderOrder"("fulfillmentId");

-- CreateIndex
CREATE INDEX "ProviderOrder_providerId_externalOrderId_idx" ON "ProviderOrder"("providerId", "externalOrderId");

-- AddForeignKey
ALTER TABLE "ProviderProduct" ADD CONSTRAINT "ProviderProduct_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProduct" ADD CONSTRAINT "ProviderProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOrder" ADD CONSTRAINT "ProviderOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOrder" ADD CONSTRAINT "ProviderOrder_providerProductId_fkey" FOREIGN KEY ("providerProductId") REFERENCES "ProviderProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOrder" ADD CONSTRAINT "ProviderOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOrder" ADD CONSTRAINT "ProviderOrder_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
