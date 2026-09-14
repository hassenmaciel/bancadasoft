-- Prepare the AdClean v2 provider without publishing the commercial product.
INSERT INTO "Provider" (
  "id",
  "name",
  "code",
  "active",
  "apiBaseUrl",
  "integrationStatus",
  "createdAt",
  "updatedAt"
)
VALUES (
  'provider-adclean-v2',
  'AdClean',
  'adclean',
  false,
  'https://repair-adclean-licenca.adclean-ha100.workers.dev',
  'NOT_CONNECTED',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "apiBaseUrl" = EXCLUDED."apiBaseUrl";

UPDATE "Product"
SET
  "deliveryType" = 'AUTOMATIC',
  "deliveryEstimate" = 'Liberação automática após o pagamento',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'adclean'
  AND "status" = 'DRAFT';

INSERT INTO "ProviderProduct" (
  "id",
  "providerId",
  "productId",
  "externalProductId",
  "label",
  "currency",
  "active",
  "mode",
  "metadata",
  "automationClass",
  "technicalEligibility",
  "homologationStatus",
  "expectedDeliveryType",
  "createdAt",
  "updatedAt"
)
SELECT
  'provider-product-adclean-ticket-168h',
  provider."id",
  product."id",
  'ticket-168h',
  'Repair AdClean — Ticket de Acesso',
  'BRL',
  true,
  'REAL',
  '{"durationHours":168,"model":"DEVICE_TICKET_V2"}'::jsonb,
  'AUTO_FIELD_BASED',
  'READY',
  'CLASS_VALIDATED',
  'CODE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Provider" provider
JOIN "Product" product ON product."slug" = 'adclean'
WHERE provider."code" = 'adclean'
ON CONFLICT ("providerId", "externalProductId") DO UPDATE
SET
  "productId" = EXCLUDED."productId",
  "label" = EXCLUDED."label",
  "metadata" = EXCLUDED."metadata",
  "automationClass" = EXCLUDED."automationClass",
  "technicalEligibility" = EXCLUDED."technicalEligibility",
  "homologationStatus" = EXCLUDED."homologationStatus",
  "expectedDeliveryType" = EXCLUDED."expectedDeliveryType",
  "updatedAt" = CURRENT_TIMESTAMP;
