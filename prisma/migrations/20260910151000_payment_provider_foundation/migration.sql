ALTER TABLE "Payment"
  ADD COLUMN "externalPaymentId" TEXT,
  ADD COLUMN "amountCents" INTEGER,
  ADD COLUMN "qrCode" TEXT;

UPDATE "Payment"
SET "amountCents" = "Order"."totalCents"
FROM "Order"
WHERE "Payment"."orderId" = "Order"."id";

ALTER TABLE "Payment" ALTER COLUMN "amountCents" SET NOT NULL;
CREATE UNIQUE INDEX "Payment_externalPaymentId_key" ON "Payment"("externalPaymentId");
