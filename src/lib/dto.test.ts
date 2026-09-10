import { describe, expect, it } from "vitest";
import { FulfillmentStatus, OrderStatus, PaymentStatus, ProductStatus, ProductType, type Category, type Product } from "@prisma/client";
import { isPublicProduct, publicProductWhere } from "./catalog";
import { normalizeQrCodeImage, orderDto, productDto } from "./dto";

const category: Category = { id: "category-1", slug: "ferramentas", name: "Ferramentas" };
const product: Product = {
  id: "product-1", slug: "unlocktool-6h", name: "UnlockTool", description: "Aluguel de teste",
  type: ProductType.RENTAL, duration: "6 horas", imageUrl: "https://cdn.example.test/unlocktool.png",
  priceCents: 2900, status: ProductStatus.PUBLISHED, available: true, categoryId: category.id,
  createdAt: new Date("2026-09-10T10:00:00Z"), updatedAt: new Date("2026-09-10T10:00:00Z"),
};

describe("DTO mappers", () => {
  it("mapeia os campos públicos, a categoria e a imagem do produto", () => {
    expect(productDto({ ...product, category })).toEqual({
      id: "product-1", slug: "unlocktool-6h", name: "UnlockTool", description: "Aluguel de teste",
      type: ProductType.RENTAL, duration: "6 horas", imageUrl: "https://cdn.example.test/unlocktool.png",
      priceCents: 2900, status: ProductStatus.PUBLISHED, available: true, category,
    });
  });

  it("mantém itens, pagamento, fulfillment e entrega no OrderDTO", () => {
    const dto = orderDto({
      id: "order-1", publicToken: "public-token", status: OrderStatus.DELIVERED, totalCents: 2900,
      createdAt: new Date("2026-09-10T10:00:00Z"),
      items: [{ id: "item-1", unitPriceCents: 2900, product: { ...product, category } }],
      payment: { status: PaymentStatus.PAID, provider: "asaas", amountCents: 2900, externalPaymentId: "pay-real", pixCode: "PIX-REAL", qrCode: "encoded-image", expiresAt: new Date("2026-09-10T10:15:00Z") },
      fulfillment: { status: FulfillmentStatus.FULFILLED, provider: "mock", delivery: { credential: "MOCK-123", instructions: "Teste" } },
      events: [{ status: OrderStatus.DELIVERED, note: "Entregue", createdAt: new Date("2026-09-10T10:01:00Z") }],
    });
    expect(dto.items[0].product.category).toEqual(category);
    expect(dto.payment).toMatchObject({ status: PaymentStatus.PAID, provider: "asaas", externalPaymentId: "pay-real", pixPayload: "PIX-REAL", qrCodeImage: "data:image/png;base64,encoded-image" });
    expect(dto.fulfillment).toMatchObject({ status: FulfillmentStatus.FULFILLED, delivery: { credential: "MOCK-123" } });
    expect(dto).not.toHaveProperty("product");
    expect(dto).not.toHaveProperty("pixCode");
    expect(dto).not.toHaveProperty("delivery");
  });

  it("normaliza a imagem real do QR Code sem alterar data URLs válidas", () => {
    expect(normalizeQrCodeImage("encoded-image")).toBe("data:image/png;base64,encoded-image");
    expect(normalizeQrCodeImage("data:image/png;base64,ready")).toBe("data:image/png;base64,ready");
    expect(normalizeQrCodeImage(null)).toBeNull();
  });
});

describe("publicação do catálogo", () => {
  it("considera público somente produto publicado e disponível", () => {
    expect(publicProductWhere).toEqual({ status: ProductStatus.PUBLISHED, available: true });
    expect(isPublicProduct(product)).toBe(true);
    expect(isPublicProduct({ ...product, status: ProductStatus.DRAFT })).toBe(false);
    expect(isPublicProduct({ ...product, status: ProductStatus.REVIEWED })).toBe(false);
    expect(isPublicProduct({ ...product, status: ProductStatus.PAUSED })).toBe(false);
    expect(isPublicProduct({ ...product, status: ProductStatus.ARCHIVED })).toBe(false);
    expect(isPublicProduct({ ...product, available: false })).toBe(false);
  });
});
