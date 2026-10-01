import { describe, expect, it } from "vitest";
import { manualDeliveryBlocker, type ManualDeliveryState } from "./manual-delivery-rules";

const base: ManualDeliveryState = {
  paymentStatus: "PAID",
  orderStatus: "FAILED",
  hasDelivery: false,
  providerOrderStatuses: ["FAILED"],
};

describe("manualDeliveryBlocker — visibilidade do botão e pré-condição da transação", () => {
  it("libera o pedido de referência (pago, FAILED, ProviderOrder FAILED, sem Delivery)", () => {
    expect(manualDeliveryBlocker(base)).toBeNull();
  });

  it("libera sem ProviderOrder e com ProviderOrder QUEUED", () => {
    expect(manualDeliveryBlocker({ ...base, providerOrderStatuses: [] })).toBeNull();
    expect(manualDeliveryBlocker({ ...base, orderStatus: "PAID", providerOrderStatuses: ["QUEUED"] })).toBeNull();
  });

  it.each([
    [{ paymentStatus: "PENDING" }, "PAYMENT_NOT_PAID"],
    [{ paymentStatus: null }, "PAYMENT_NOT_PAID"],
    [{ paymentStatus: "REFUNDED" }, "PAYMENT_NOT_PAID"],
    [{ orderStatus: "DELIVERED" }, "ORDER_ALREADY_DELIVERED"],
    [{ orderStatus: "CANCELLED" }, "ORDER_CANCELLED"],
    [{ providerOrderStatuses: ["PROCESSING"] }, "PROVIDER_ORDER_PROCESSING"],
    [{ providerOrderStatuses: ["COMPLETED"] }, "PROVIDER_ORDER_COMPLETED"],
    [{ hasDelivery: true }, "DELIVERY_ALREADY_EXISTS"],
  ] as Array<[Partial<ManualDeliveryState>, string]>)("%j → %s", (patch, code) => {
    expect(manualDeliveryBlocker({ ...base, ...patch })).toBe(code);
  });
});
