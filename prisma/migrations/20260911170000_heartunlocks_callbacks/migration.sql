CREATE TABLE "ProviderCallbackEvent" (
    "id" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderCallbackEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProviderCallbackEvent_eventKey_key" ON "ProviderCallbackEvent"("eventKey");
CREATE INDEX "ProviderCallbackEvent_providerOrderId_createdAt_idx" ON "ProviderCallbackEvent"("providerOrderId", "createdAt");
ALTER TABLE "ProviderCallbackEvent" ADD CONSTRAINT "ProviderCallbackEvent_providerOrderId_fkey" FOREIGN KEY ("providerOrderId") REFERENCES "ProviderOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
