-- ProviderOrder is the single persistent execution record for a fulfillment.
ALTER TABLE "ProviderOrder" ALTER COLUMN "fulfillmentId" SET NOT NULL;
CREATE UNIQUE INDEX "ProviderOrder_fulfillmentId_key" ON "ProviderOrder"("fulfillmentId");
