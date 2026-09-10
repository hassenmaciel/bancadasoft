ALTER TABLE "User" ADD COLUMN "asaasCustomerId" TEXT;
CREATE UNIQUE INDEX "User_asaasCustomerId_key" ON "User"("asaasCustomerId");
