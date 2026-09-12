CREATE TYPE "AutomationClass" AS ENUM ('AUTO_CREDENTIAL', 'AUTO_GENERIC_REPLAY', 'AUTO_FIELD_BASED', 'REMOTE_SESSION', 'MANUAL_REVIEW', 'UNSUPPORTED');
CREATE TYPE "TechnicalEligibility" AS ENUM ('READY', 'REVIEW', 'UNSUPPORTED');
CREATE TYPE "HomologationStatus" AS ENUM ('UNTESTED', 'CLASS_VALIDATED', 'PRODUCT_VALIDATED', 'FAILED');
CREATE TYPE "ProviderDeliveryType" AS ENUM ('CREDENTIALS', 'LICENSE', 'CODE', 'TEXT', 'MULTI_FIELD');

ALTER TABLE "OrderItem" ADD COLUMN "providerFields" JSONB;
ALTER TABLE "ProviderProduct"
  ADD COLUMN "automationClass" "AutomationClass" NOT NULL DEFAULT 'MANUAL_REVIEW',
  ADD COLUMN "technicalEligibility" "TechnicalEligibility" NOT NULL DEFAULT 'REVIEW',
  ADD COLUMN "homologationStatus" "HomologationStatus" NOT NULL DEFAULT 'UNTESTED',
  ADD COLUMN "contractSignature" TEXT,
  ADD COLUMN "fieldSchema" JSONB,
  ADD COLUMN "expectedDeliveryType" "ProviderDeliveryType" NOT NULL DEFAULT 'TEXT';

CREATE INDEX "ProviderProduct_providerId_automationClass_technicalEligibil_idx" ON "ProviderProduct"("providerId", "automationClass", "technicalEligibility");
CREATE INDEX "ProviderProduct_contractSignature_idx" ON "ProviderProduct"("contractSignature");
