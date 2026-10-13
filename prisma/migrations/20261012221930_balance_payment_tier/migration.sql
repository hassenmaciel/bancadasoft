-- PREMIUM_PLUS e canUseBalanceAsPayment já existiam em produção (aplicados
-- fora do histórico de migrations); IF NOT EXISTS mantém esta migration
-- correta tanto lá quanto num banco novo.

-- AlterEnum
ALTER TYPE "CustomerTier" ADD VALUE IF NOT EXISTS 'PREMIUM_PLUS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canUseBalanceAsPayment" BOOLEAN NOT NULL DEFAULT false;
