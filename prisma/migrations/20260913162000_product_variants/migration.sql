-- AddTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "providerProductId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER,
    "pricingMode" "PricingMode" NOT NULL DEFAULT 'AUTO_GLOBAL',
    "manualPriceCents" INTEGER,
    "suggestedPriceCents" INTEGER,
    "pricingStatus" "PricingStatus" NOT NULL DEFAULT 'INVALID_CONFIG',
    "pricingComputedAt" TIMESTAMP(3),
    "publicationBlocked" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "productVariantId" TEXT,
ADD COLUMN "providerProductId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_providerProductId_key" ON "ProductVariant"("providerProductId");
CREATE UNIQUE INDEX "ProductVariant_productId_code_key" ON "ProductVariant"("productId", "code");
CREATE INDEX "ProductVariant_productId_active_sortOrder_idx" ON "ProductVariant"("productId", "active", "sortOrder");
CREATE INDEX "OrderItem_productVariantId_idx" ON "OrderItem"("productVariantId");
CREATE INDEX "OrderItem_providerProductId_idx" ON "OrderItem"("providerProductId");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_providerProductId_fkey" FOREIGN KEY ("providerProductId") REFERENCES "ProviderProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_providerProductId_fkey" FOREIGN KEY ("providerProductId") REFERENCES "ProviderProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prepare the approved FRPFILE commercial catalog as DRAFT only.
INSERT INTO "Brand" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES ('brand-frpfile', 'FRPFILE', 'frpfile', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Category" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES ('category-apple-services', 'Serviços Apple', 'servicos-apple', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Product" (
  "id", "slug", "name", "description", "type", "deliveryType", "deliveryEstimate",
  "searchTerms", "priceCents", "pricingMode", "pricingStatus", "featured", "sortOrder",
  "status", "available", "categoryId", "brandId", "createdAt", "updatedAt"
)
SELECT source.id, source.slug, source.name, source.description, 'IMEI_SN'::"ProductType",
  'AUTOMATIC'::"DeliveryType", source.estimate, source.searchTerms, 0,
  'AUTO_GLOBAL'::"PricingMode", 'INVALID_CONFIG'::"PricingStatus", false,
  source.sortOrder, 'DRAFT'::"ProductStatus", true, category.id, brand.id,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('frpfile-premium', 'frpfile-premium', 'FRPFILE Premium', 'Serviços FRPFILE Premium para dispositivos Apple compatíveis.', '1–5 minutos', 'frpfile premium bypass icloud passcode baseband mdm', 100),
  ('frpfile-activator-a5-a6', 'frpfile-activator-a5-a6', 'FRPFILE Activator A5/A6', 'Ativação FRPFILE para dispositivos A5 e A6 compatíveis.', '1–5 minutos', 'frpfile activator a5 a6', 110),
  ('frpfile-activator-a12-plus', 'frpfile-activator-a12-plus', 'FRPFILE Activator A12+', 'Bypass Hello Screen para dispositivos A12+ conforme a variante selecionada.', '1–5 minutos', 'frpfile activator a12 bypass hello screen', 120),
  ('frpfile-ramdisk-passcode', 'frpfile-ramdisk-passcode-disabled', 'FRPFILE Ramdisk — Passcode/Disabled', 'Serviços Ramdisk por ECID para aparelhos em Passcode ou Disabled.', '1–24 horas', 'frpfile ramdisk passcode disabled ecid', 130),
  ('frpfile-ramdisk-hello', 'frpfile-ramdisk-hello-wifi', 'FRPFILE Ramdisk — Hello Screen/Wi-Fi', 'Serviços FRPFILE para Hello Screen, Wi-Fi e aparelhos sem sinal.', '1–5 minutos', 'frpfile ramdisk hello screen wifi no signal', 140),
  ('frpfile-mdm-mobile', 'frpfile-mdm-iphone-ipad', 'FRPFILE MDM — iPhone/iPad', 'Serviço MDM para iPhone e iPad conforme compatibilidade.', '1–5 minutos', 'frpfile mdm iphone ipad', 150),
  ('frpfile-mdm-mac', 'frpfile-mdm-macbook', 'FRPFILE MDM — MacBook', 'Serviço MDM para MacBook T2 e Apple Silicon compatíveis.', '1–5 minutos', 'frpfile mdm macbook t2 m1 m2 m3 m4', 160),
  ('frpfile-fmi-off', 'frpfile-fmi-off-open-menu', 'FRPFILE FMI OFF — Open Menu', 'Serviço FMI OFF/Open Menu para iPhone e iPad.', '1–5 minutos', 'frpfile fmi off open menu iphone ipad', 170),
  ('frpfile-open-menu-mac', 'frpfile-open-menu-macbook', 'FRPFILE Open Menu — MacBook', 'Serviço Open Menu para MacBook.', '1–5 minutos', 'frpfile open menu macbook', 180),
  ('frpfile-screen-time', 'frpfile-screen-time-open-menu', 'FRPFILE Screen Time/Open Menu', 'Remoção de Screen Time e bypass Open Menu conforme modelo selecionado.', '1–72 horas', 'frpfile screen time open menu iphone ipad', 190),
  ('frpfile-t2', 'frpfile-macbook-t2-bypass', 'FRPFILE MacBook T2 Bypass', 'Bypass iCloud para Macs com chip T2 conforme a variante selecionada.', '1–5 minutos', 'frpfile macbook t2 bypass configurator windows', 200),
  ('frpfile-owner-info', 'frpfile-mac-owner-info', 'FRPFILE Mac Finder Owner Info', 'Consulta de informações do proprietário para Macs compatíveis.', '1–5 minutos', 'frpfile mac finder owner info', 210)
) AS source(id, slug, name, description, estimate, searchTerms, sortOrder)
JOIN "Category" category ON category."slug" = 'servicos-apple'
JOIN "Brand" brand ON brand."slug" = 'frpfile'
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "ProductVariant" (
  "id", "productId", "providerProductId", "name", "code", "active", "sortOrder",
  "priceCents", "pricingMode", "manualPriceCents", "suggestedPriceCents", "pricingStatus",
  "pricingComputedAt", "publicationBlocked", "holdReason", "createdAt", "updatedAt"
)
SELECT 'frpfile-variant-' || source.externalId, source.productId, providerProduct.id,
  source.name, source.code, source.active, source.sortOrder, NULL,
  'AUTO_GLOBAL'::"PricingMode", NULL, source.suggestedPrice,
  'INVALID_CONFIG'::"PricingStatus", CURRENT_TIMESTAMP, source.blocked,
  source.holdReason, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('frpfile-premium', '221', 'Premium Bypass/Passcode/Baseband/MDM', 'premium', true, 10, 1590, false, NULL),
  ('frpfile-activator-a5-a6', '3081', 'A5/A6 sem Arduino', 'a5-a6-sem-arduino', true, 10, 1490, false, NULL),
  ('frpfile-activator-a12-plus', '3126', 'A12+ com serviço iCloud', 'a12-plus-com-icloud', true, 10, 5490, false, NULL),
  ('frpfile-activator-a12-plus', '3128', 'A12+ sem serviço iCloud', 'a12-plus-sem-icloud', true, 20, 3790, false, NULL),
  ('frpfile-ramdisk-passcode', '223', 'iOS 11–16 sem jailbreak', 'ios-11-16-sem-jailbreak', true, 10, 2190, false, NULL),
  ('frpfile-ramdisk-passcode', '4400', 'A12 com sinal/Owner Info', 'a12-com-sinal', true, 20, 5790, false, NULL),
  ('frpfile-ramdisk-passcode', '4401', 'A13 com sinal/Owner Info', 'a13-com-sinal', true, 30, 5790, false, NULL),
  ('frpfile-ramdisk-hello', '222', 'Hello Screen/Broken Baseband iOS 15–17', 'hello-baseband-ios-15-17', true, 10, 2190, false, NULL),
  ('frpfile-ramdisk-hello', '224', 'Wi-Fi iOS 12–18, sem sinal', 'wifi-ios-12-18', true, 20, 2190, false, NULL),
  ('frpfile-ramdisk-hello', '4493', 'A12/A13 Hello Screen, sem sinal', 'a12-a13-sem-sinal', true, 30, 5790, false, NULL),
  ('frpfile-mdm-mobile', '226', 'MDM iPhone/iPad', 'mdm-iphone-ipad', true, 10, 1590, false, NULL),
  ('frpfile-mdm-mac', '228', 'MDM MacBook T2/M1/M2/M3/M4', 'mdm-macbook', true, 10, 4290, false, NULL),
  ('frpfile-fmi-off', '3175', 'FMI OFF/Open Menu', 'fmi-off-open-menu', false, 10, 1590, true, 'Origem/formato do Order code não confirmado.'),
  ('frpfile-open-menu-mac', '230', 'Open Menu MacBook', 'open-menu-macbook', false, 10, 3890, true, 'Origem/formato do Code não confirmado.'),
  ('frpfile-screen-time', '3183', 'iPhone 17/17 Air/17 Pro/17 Pro Max', 'iphone-17', true, 10, 29190, false, NULL),
  ('frpfile-screen-time', '3475', 'iPad M1–M4', 'ipad-m1-m4', true, 20, 21990, false, NULL),
  ('frpfile-screen-time', '3476', 'iPad A12–A15', 'ipad-a12-a15', true, 30, 16190, false, NULL),
  ('frpfile-screen-time', '3477', 'iPhone 12', 'iphone-12', true, 40, 14690, false, NULL),
  ('frpfile-screen-time', '3478', 'iPhone 11', 'iphone-11', true, 50, 13290, false, NULL),
  ('frpfile-screen-time', '3479', 'iPhone 13', 'iphone-13', true, 60, 13290, false, NULL),
  ('frpfile-screen-time', '3480', 'iPhone 14', 'iphone-14', true, 70, 21190, false, NULL),
  ('frpfile-screen-time', '3481', 'iPhone 15', 'iphone-15', true, 80, 21190, false, NULL),
  ('frpfile-screen-time', '3482', 'iPhone 16/16e', 'iphone-16', true, 90, 21190, false, NULL),
  ('frpfile-screen-time', '3483', 'iPhone XR/XS/XS Max', 'iphone-xr-xs', true, 100, 8990, false, NULL),
  ('frpfile-screen-time', '3484', 'iPhone SE2/SE3', 'iphone-se2-se3', true, 110, 8990, false, NULL),
  ('frpfile-t2', '225', 'Serviço T2 padrão', 't2-padrao', true, 10, 13290, false, NULL),
  ('frpfile-t2', '229', 'Windows Tool/Apple Configurator', 't2-windows-configurator', true, 20, 11890, false, NULL),
  ('frpfile-owner-info', '227', 'Mac Finder Owner Info', 'mac-owner-info', true, 10, 2590, false, NULL)
) AS source(productId, externalId, name, code, active, sortOrder, suggestedPrice, blocked, holdReason)
JOIN "Provider" provider ON provider."code" = 'heartunlocks'
JOIN "ProviderProduct" providerProduct ON providerProduct."providerId" = provider.id AND providerProduct."externalProductId" = source.externalId
JOIN "Product" product ON product.id = source.productId
ON CONFLICT ("providerProductId") DO NOTHING;
