import { describe, expect, it } from "vitest";
import { DeliveryType, FulfillmentStatus, OrderStatus, PaymentStatus, ProductStatus, ProductType, type Category, type Product } from "@prisma/client";
import { isPublicProduct, publicProductWhere } from "./catalog";
import { normalizeQrCodeImage, orderDto, productDto } from "./dto";

const category: Category = { id: "category-1", slug: "ferramentas", name: "Ferramentas", active: true, createdAt: new Date("2026-09-10T10:00:00Z"), updatedAt: new Date("2026-09-10T10:00:00Z") };
const categoryDto = { id: category.id, slug: category.slug, name: category.name };
const product: Product = {
  id: "product-1", slug: "unlocktool-6h", name: "UnlockTool", description: "Aluguel de teste",
  type: ProductType.RENTAL, deliveryType: DeliveryType.AUTOMATIC, deliveryEstimate: "imediato", searchTerms: "unlocktool aluguel", longDescription: null, duration: "6 horas", imageUrl: "https://cdn.example.test/unlocktool.png",
  priceCents: 2900, costCents: 1000, featured: false, sortOrder: 0, status: ProductStatus.PUBLISHED, available: true, categoryId: category.id, brandId: null,
  createdAt: new Date("2026-09-10T10:00:00Z"), updatedAt: new Date("2026-09-10T10:00:00Z"),
};

describe("DTO mappers", () => {
  it("mapeia os campos públicos, a categoria e a imagem do produto", () => {
    expect(productDto({ ...product, category })).toEqual({
      id: "product-1", slug: "unlocktool-6h", name: "UnlockTool", description: "Aluguel de teste",
      type: ProductType.RENTAL, deliveryType: DeliveryType.AUTOMATIC, deliveryEstimate: "imediato", longDescription: null, duration: "6 horas", imageUrl: "https://cdn.example.test/unlocktool.png",
      priceCents: 2900, status: ProductStatus.PUBLISHED, available: true, category: categoryDto, brand: null, checkoutFields: [], variants: [],
    });
    expect(productDto({ ...product, category })).not.toHaveProperty("costCents");
    expect(productDto({ ...product, category })).not.toHaveProperty("manualPriceCents");
    expect(productDto({ ...product, category })).not.toHaveProperty("suggestedPriceCents");
    expect(productDto({ ...product, category })).not.toHaveProperty("pricingStatus");
  });

  it("expõe variantes comerciais sem provider, custo ou assinatura interna", () => {
    const dto = productDto({
      ...product,
      category,
      variants: [{
        id: "variant-1", name: "A12", active: true, sortOrder: 1,
        priceCents: 5790, publicationBlocked: false,
        providerProduct: {
          active: true, mode: "REAL", technicalEligibility: "READY",
          fieldSchema: [{ key: "ecid", label: "ECID", type: "text", required: true, customerVisible: true, sensitive: false }],
          provider: { active: true, code: "heartunlocks" },
          providerCostCents: 380, contractSignature: "internal-signature",
        },
      }],
    });
    expect(dto.variants).toEqual([{ id: "variant-1", name: "A12", priceCents: 5790, checkoutFields: [expect.objectContaining({ key: "ecid", label: "ECID" })] }]);
    expect(dto.priceCents).toBe(5790);
    expect(JSON.stringify(dto)).not.toMatch(/providerCostCents|contractSignature|heartunlocks/);
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
    expect(dto.items[0].product.category).toEqual(categoryDto);
    expect(dto.payment).toMatchObject({ status: PaymentStatus.PAID, externalPaymentId: "pay-real", pixPayload: "PIX-REAL", qrCodeImage: "data:image/png;base64,encoded-image" });
    expect(dto.payment).not.toHaveProperty("provider");
    expect(dto.fulfillment).toMatchObject({ status: FulfillmentStatus.FULFILLED, delivery: { credential: "MOCK-123" } });
    expect(dto.fulfillment).not.toHaveProperty("provider");
    expect(dto).not.toHaveProperty("product");
    expect(dto).not.toHaveProperty("pixCode");
    expect(dto).not.toHaveProperty("delivery");
  });

  it("remove a entrega quando o pedido é consultado apenas por token público", () => {
    const dto = orderDto({
      id:"order-1", publicToken:"public-token", status:OrderStatus.DELIVERED, totalCents:2900, createdAt:new Date(),
      items:[{id:"item-1",unitPriceCents:2900,product:{...product,category}}], payment:null,
      fulfillment:{status:FulfillmentStatus.FULFILLED,delivery:{username:"private-user",password:"private-pass"}}, events:[],
    }, {includeDelivery:false});
    expect(dto.fulfillment?.status).toBe(FulfillmentStatus.FULFILLED);
    expect(dto.fulfillment?.delivery).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("private-user");
    expect(JSON.stringify(dto)).not.toContain("private-pass");
  });

  it("não expõe CODE quando o pedido é consultado apenas por token público", () => {
    const dto = orderDto({
      id:"order-code", publicToken:"public-code", status:OrderStatus.DELIVERED, totalCents:9000, createdAt:new Date(),
      items:[{id:"item-code",unitPriceCents:9000,product:{...product,category}}], payment:null,
      fulfillment:{status:FulfillmentStatus.FULFILLED,delivery:{deliveryType:"CODE",credential:"PRIVATE-CODE"}}, events:[],
    }, {includeDelivery:false});
    expect(dto.fulfillment?.delivery).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("PRIVATE-CODE");
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
