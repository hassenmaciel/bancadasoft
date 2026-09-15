-- AlterTable: adiciona o link oficial de download do produto (opcional, aditivo).
-- Não depende de pagamento/fulfillment/credential — apenas um link informativo do instalador.
ALTER TABLE "Product" ADD COLUMN "downloadUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "downloadLabel" TEXT;
