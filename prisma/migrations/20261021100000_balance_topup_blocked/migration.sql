-- Bloqueio de recarga por cliente, controlado pelo Admin. Ligado: o cliente
-- não consegue recarregar e uma recarga creditada não promove a PREMIUM_PLUS
-- (o valor pago ainda entra no saldo). Default false: nada muda para as contas
-- existentes.
--
-- Reversão (manual):
--   ALTER TABLE "User" DROP COLUMN IF EXISTS "balanceTopupBlocked";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261021100000_balance_topup_blocked';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "balanceTopupBlocked" BOOLEAN NOT NULL DEFAULT false;
