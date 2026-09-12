import { describe, expect, it } from "vitest";
import { buildHeartUnlocksOrderPayload } from "./order-payload.mjs";

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

  it("rejects a quantity other than one", () => {
    expect(() =>
      buildHeartUnlocksOrderPayload({
        productUuid: "2337",
        referenceId: "provider-order-amt-test",
        quantity: 2,
        feedbackBase: "https://gateway.example.test",
        callbackSecret: "test-secret",
      }),
    ).toThrow("INVALID_ORDER_PAYLOAD");
  });
});
