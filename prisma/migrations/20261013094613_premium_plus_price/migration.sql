-- Preço próprio do tier PREMIUM_PLUS. Colunas opcionais e sem default: as
-- linhas existentes ficam NULL e continuam usando o preço Premium, então
-- nenhum preço muda até o campo ser preenchido no Admin.
--
-- Reversão (manual, só se nenhum preço Premium Plus estiver em uso):
--   ALTER TABLE "Product" DROP COLUMN IF EXISTS "premiumPlusPriceCents";
--   ALTER TABLE "ProductVariant" DROP COLUMN IF EXISTS "premiumPlusPriceCents";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261013094613_premium_plus_price';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "premiumPlusPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "premiumPlusPriceCents" INTEGER;
