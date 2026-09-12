CREATE TYPE "DeliveryNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED');
CREATE TABLE "DeliveryNotification" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "status" "DeliveryNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL DEFAULT 'resend',
  "recipientMasked" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryNotification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryNotification_orderId_channel_key" ON "DeliveryNotification"("orderId", "channel");
CREATE INDEX "DeliveryNotification_status_createdAt_idx" ON "DeliveryNotification"("status", "createdAt");
ALTER TABLE "DeliveryNotification" ADD CONSTRAINT "DeliveryNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
