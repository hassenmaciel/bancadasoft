-- Quantidade por pedido (créditos Phoenix: mínimo 5). Aditiva: só adiciona
-- colunas com default; o default 1/1 mantém todo o catálogo atual com
-- quantidade fixa 1 e os OrderItems existentes passam a valer quantity=1, que
-- é exatamente o que foi vendido.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "minQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN "maxQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN "acceptsSuccessWithoutText" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- Integridade (fora do modelo Prisma)
ALTER TABLE "Product" ADD CONSTRAINT "Product_quantity_range"
  CHECK ("minQuantity" >= 1 AND "maxQuantity" >= "minQuantity");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive"
  CHECK ("quantity" >= 1);
