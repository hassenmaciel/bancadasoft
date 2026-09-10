import { describe, expect, it } from "vitest";
import { adminOrderDto, type AdminOrderRecord } from "./admin-order";

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
});
