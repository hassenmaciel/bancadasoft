import { describe, expect, it } from "vitest";
import {
  adminCallbackDto,
  adminOrderDto,
  adminOrderListDto,
  sanitizeProviderError,
  type AdminOrderListRecord,
  type AdminOrderRecord,
} from "./admin-order";

describe("mapper administrativo de pedido", () => {
  it("mantém pagamento, eventos, fulfillment, entrega e histórico separados", () => {
    const date = new Date("2026-09-10T12:00:00Z");
    const record = {
      id:"order-1", publicToken:"public", status:"DELIVERED", customerId:"user-1", totalCents:2900, createdAt:date, updatedAt:date,
      customer:{id:"user-1",name:"Cliente",email:"cliente@example.test"},
      items:[{id:"item-1",orderId:"order-1",productId:"product-1",unitPriceCents:2900,product:{id:"product-1",name:"UnlockTool",slug:"unlocktool"}}],
      payment:{id:"payment-1",orderId:"order-1",provider:"mock",status:"PAID",providerReference:"ref",pixCode:"PIX",expiresAt:date,createdAt:date,events:[{id:"event-1",providerEventId:"provider-event",paymentId:"payment-1",payload:{},createdAt:date}]},
      fulfillment:{id:"fulfillment-1",orderId:"order-1",provider:"mock",status:"FULFILLED",delivery:{credential:"MOCK-1"},createdAt:date,updatedAt:date,providerOrders:[]},
      events:[{id:"history-1",orderId:"order-1",status:"DELIVERED",note:"Entrega disponível",createdAt:date}],
    } as unknown as AdminOrderRecord;
    const dto = adminOrderDto(record);
    expect(dto.payment?.events[0].providerEventId).toBe("provider-event");
    expect(dto.fulfillment?.delivery).toEqual({ credential: "MOCK-1" });
    expect(dto.events[0]).toMatchObject({ status: "DELIVERED", note: "Entrega disponível" });
    expect(dto.payment?.status).toBe("PAID");
    expect(dto.fulfillment?.status).toBe("FULFILLED");
  });

  it("expõe somente metadados seguros do callback", () => {
    const date = new Date("2026-09-10T12:00:00Z");
    const dto = adminCallbackDto({id:"callback-1",status:"success",createdAt:date,processedAt:date,payload:{reference_id:"reference-1",order_id:"provider-order-1",replay:"U0VDUkVUX1BBU1NXT1JE"}});
    expect(dto).toMatchObject({referenceId:"reference-1",providerOrderId:"provider-order-1",status:"success"});
    expect(dto).not.toHaveProperty("payload");
    expect(dto).not.toHaveProperty("replay");
    expect(JSON.stringify(dto)).not.toContain("U0VDUkVUX1BBU1NXT1JE");
  });

  it("sanitiza credenciais acidentalmente presentes no último erro", () => {
    expect(sanitizeProviderError("HTTP 401 Bearer abc123 password=unsafe token:also-unsafe")).toBe("HTTP 401 Bearer [REDACTED] password=[REDACTED] token=[REDACTED]");
  });

  it("DTO de listagem (PARTE 8/16) mascara CPF e nunca inclui entrega/pix/senha", () => {
    const record = {
      id: "order-1",
      publicToken: "public",
      status: "DELIVERED",
      totalCents: 2900,
      createdAt: new Date("2026-09-15T12:00:00Z"),
      customer: {
        name: "Cliente Guest",
        email: "guest@example.test",
        whatsapp: "5511987654321",
        cpfCnpj: "52998224725",
        passwordHash: "PENDING_INVITE",
      },
      items: [
        {
          product: { name: "UnlockTool" },
          productVariant: { name: "A12" },
        },
      ],
      payment: { status: "PAID" },
      fulfillment: { status: "FULFILLED" },
    } as unknown as AdminOrderListRecord;
    const dto = adminOrderListDto(record);
    expect(dto.customer.cpfMasked).toBe("***.***.***-25");
    expect(dto.customer.guest).toBe(true);
    expect(dto.items[0]).toEqual({ productName: "UnlockTool", variant: "A12" });
    expect(dto.paymentStatus).toBe("PAID");
    expect(dto.fulfillmentStatus).toBe("FULFILLED");
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("52998224725");
    expect(serialized).not.toContain("PENDING_INVITE");
    expect(dto).not.toHaveProperty("customer.cpfCnpj");
    expect(dto).not.toHaveProperty("fulfillment");
    expect(dto).not.toHaveProperty("delivery");
  });
});
