-- Additive commercial segmentation. Existing products remain public and retain their prices.
CREATE TYPE "CustomerTier" AS ENUM ('NORMAL', 'PREMIUM');
CREATE TYPE "PriceVisibility" AS ENUM ('PUBLIC', 'LOGIN_REQUIRED');

ALTER TABLE "User"
  ADD COLUMN "customerTier" "CustomerTier" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "Product"
  ADD COLUMN "priceVisibility" "PriceVisibility" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "normalPriceCents" INTEGER,
  ADD COLUMN "premiumPriceCents" INTEGER;

ALTER TABLE "ProductVariant"
  ADD COLUMN "normalPriceCents" INTEGER,
  ADD COLUMN "premiumPriceCents" INTEGER;

-- AdClean remains unavailable while its provider integration is not implemented.
UPDATE "Product"
SET
  "name" = 'Repair AdClean — Ticket de Acesso',
  "description" = 'Limpeza eficiente de anúncios e adware em aparelhos Android.',
  "duration" = '7 dias (168 horas)',
  "priceCents" = 2000,
  "manualPriceCents" = 2000,
  "pricingMode" = 'MANUAL',
  "pricingStatus" = 'MANUAL',
  "normalPriceCents" = 2000,
  "premiumPriceCents" = 1000,
  "priceVisibility" = 'LOGIN_REQUIRED',
  "status" = 'DRAFT',
  "available" = false
WHERE "slug" = 'adclean';
