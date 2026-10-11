import { describe, expect, it } from "vitest";
import { buildHeartUnlocksOrderPayload, isValidOrderQuantity, MAX_ORDER_QUANTITY } from "./order-payload.mjs";

describe("HeartUnlocks quantity-only rental payload", () => {
  it("maps AMT 2337 with Quantity, reference_id and authenticated feedback_url", () => {
    const payload = buildHeartUnlocksOrderPayload({
      productUuid: "2337",
      referenceId: "provider-order-amt-test",
      quantity: 1,
      feedbackBase: "https://gateway.example.test",
      callbackSecret: "test-callback-secret",
      fields: { IMEI: "123456789012345" },
    });
    expect(payload).toEqual([
      {
        product_uuid: "2337",
        fields: [
          {
            feedback_url:
              "https://gateway.example.test/callbacks/heartunlocks?token=test-callback-secret",
            reference_id: "provider-order-amt-test",
            Quantity: 1,
            IMEI: "123456789012345",
          },
        ],
      },
    ]);
  });

  it("maps Phoenix 1808 with Quantity 5 and the account Email", () => {
    const [order] = buildHeartUnlocksOrderPayload({
      productUuid: "1808",
      referenceId: "provider-order-phoenix-test",
      quantity: 5,
      feedbackBase: "https://gateway.example.test",
      callbackSecret: "test-secret",
      fields: { Quantity: 99, Email: "conta@exemplo.test" },
    });
    // Quantity vem sempre do campo validado, nunca de fields.
    expect(order.fields[0]).toMatchObject({ Quantity: 5, Email: "conta@exemplo.test" });
  });

  it.each([0, -1, 1.5, "5", 101, Number.NaN, undefined])("rejects invalid quantity %s", (quantity) => {
    expect(() =>
      buildHeartUnlocksOrderPayload({
        productUuid: "2337",
        referenceId: "provider-order-amt-test",
        quantity,
        feedbackBase: "https://gateway.example.test",
        callbackSecret: "test-secret",
      }),
    ).toThrow("INVALID_ORDER_PAYLOAD");
  });

  it("accepts the full range 1..MAX_ORDER_QUANTITY", () => {
    expect(isValidOrderQuantity(1)).toBe(true);
    expect(isValidOrderQuantity(MAX_ORDER_QUANTITY)).toBe(true);
    expect(isValidOrderQuantity(MAX_ORDER_QUANTITY + 1)).toBe(false);
  });
});
