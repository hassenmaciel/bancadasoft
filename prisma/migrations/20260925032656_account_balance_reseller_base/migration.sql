-- Base de saldo pré-pago por conta e revenda AdClean (aditiva).
-- Cria AccountBalance (saldo materializado 1:1 com User), AccountLedgerEntry
-- (lançamentos imutáveis; sourceOrderId único garante idempotência da recarga)
-- e ResellerApiKey (hash de token revogável), além de ProductType.BALANCE_TOPUP
-- e Product.resellerPriceCents. Não altera nenhuma tabela ou dado existente.

-- CreateEnum
CREATE TYPE "AccountLedgerEntryType" AS ENUM ('TOPUP', 'PURCHASE', 'REFUND', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "ProductType" ADD VALUE 'BALANCE_TOPUP';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "resellerPriceCents" INTEGER;

-- CreateTable
CREATE TABLE "AccountBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountLedgerEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "sourceOrderId" TEXT,
    "externalReference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResellerApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResellerApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountBalance_userId_key" ON "AccountBalance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountLedgerEntry_sourceOrderId_key" ON "AccountLedgerEntry"("sourceOrderId");

-- CreateIndex
CREATE INDEX "AccountLedgerEntry_userId_idx" ON "AccountLedgerEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerApiKey_tokenHash_key" ON "ResellerApiKey"("tokenHash");

-- AddForeignKey
ALTER TABLE "AccountBalance" ADD CONSTRAINT "AccountBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountLedgerEntry" ADD CONSTRAINT "AccountLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResellerApiKey" ADD CONSTRAINT "ResellerApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesma política das demais tabelas (migration security_rls_lockdown):
-- RLS ligado, sem policies, sem acesso para anon/authenticated via Data API.
ALTER TABLE public."AccountBalance" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."AccountBalance" FROM anon, authenticated;

ALTER TABLE public."AccountLedgerEntry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."AccountLedgerEntry" FROM anon, authenticated;

ALTER TABLE public."ResellerApiKey" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public."ResellerApiKey" FROM anon, authenticated;
