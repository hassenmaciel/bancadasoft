import { describe, expect, it } from "vitest";
import { parseHeartUnlocksOrderResponse } from "./order-response.mjs";

// Mesmo formato observado na VPS em 19 e 20/10: status, message, code, data (1 item) e meta.
const response = (data, status = "success") => ({ status, message: "Order placed", code: 200, data, meta: {} });

describe("HeartUnlocks order creation response", () => {
  it("accepts data: [string] as the orderId", () => {
    expect(parseHeartUnlocksOrderResponse(response(["I26101901ABC"]))).toEqual({ orderId: "I26101901ABC", itemType: "string" });
  });

  it("still accepts data: [{ order_uuid }] as before", () => {
    expect(parseHeartUnlocksOrderResponse(response([{ order_uuid: "uuid-1" }]))).toEqual({ orderId: "uuid-1", itemType: "object" });
  });

  it("accepts data: [{ order_id }]", () => {
    expect(parseHeartUnlocksOrderResponse(response([{ order_id: 123 }]))).toEqual({ orderId: "123", itemType: "object" });
  });

  it.each([
    ["data: [null]", response([null]), "null"],
    ["empty data", response([]), "empty"],
    ["data: [object without id]", response([{ foo: "bar" }]), "object"],
    ["data: [blank string]", response(["  "]), "string"],
    ["data: [number]", response([42]), "number"],
    ["missing data", { status: "success" }, "undefined"],
  ])("rejects %s and reports only the type", (_label, result, itemType) => {
    expect(parseHeartUnlocksOrderResponse(result)).toEqual({ orderId: null, itemType });
  });

  it("rejects a string orderId when status is not success", () => {
    expect(parseHeartUnlocksOrderResponse(response(["I26101901ABC"], "error"))).toEqual({ orderId: null, itemType: "string" });
  });
});
