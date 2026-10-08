import { describe, expect, it } from "vitest";
import {
  manualDeliveryBlocker,
  type ManualDeliveryProviderOrder,
  type ManualDeliveryState,
} from "./manual-delivery-rules";

const po = (
  status: string,
  extra: Partial<ManualDeliveryProviderOrder> = {},
): ManualDeliveryProviderOrder => ({
  status,
  lastError: null,
  externalOrderId: null,
  callbackEventCount: 0,
  ...extra,
});
const uncertain = po("PROCESSING", { lastError: "PROVIDER_RESULT_UNCERTAIN" });

const base: ManualDeliveryState = {
  paymentStatus: "PAID",
  orderStatus: "FAILED",
  hasDelivery: false,
  providerOrders: [po("FAILED")],
};

describe("manualDeliveryBlocker — visibilidade do botão e pré-condição da transação", () => {
  it("libera o pedido de referência (pago, FAILED, ProviderOrder FAILED, sem Delivery)", () => {
    expect(manualDeliveryBlocker(base)).toBeNull();
  });

  it("libera sem ProviderOrder e com ProviderOrder QUEUED", () => {
    expect(manualDeliveryBlocker({ ...base, providerOrders: [] })).toBeNull();
    expect(manualDeliveryBlocker({ ...base, orderStatus: "PAID", providerOrders: [po("QUEUED")] })).toBeNull();
  });

  it.each([
    [{ paymentStatus: "PENDING" }, "PAYMENT_NOT_PAID"],
    [{ paymentStatus: null }, "PAYMENT_NOT_PAID"],
    [{ paymentStatus: "REFUNDED" }, "PAYMENT_NOT_PAID"],
    [{ orderStatus: "DELIVERED" }, "ORDER_ALREADY_DELIVERED"],
    [{ orderStatus: "CANCELLED" }, "ORDER_CANCELLED"],
    [{ providerOrders: [po("PROCESSING")] }, "PROVIDER_ORDER_PROCESSING"],
    [{ providerOrders: [po("COMPLETED")] }, "PROVIDER_ORDER_COMPLETED"],
    [{ hasDelivery: true }, "DELIVERY_ALREADY_EXISTS"],
  ] as Array<[Partial<ManualDeliveryState>, string]>)("%j → %s", (patch, code) => {
    expect(manualDeliveryBlocker({ ...base, ...patch })).toBe(code);
  });
});

describe("manualDeliveryBlocker — PROCESSING incerto sem evidência do fornecedor", () => {
  it("libera PROCESSING incerto sem externalOrderId e sem callback (#9KJH34LN)", () => {
    expect(
      manualDeliveryBlocker({ ...base, orderStatus: "PROCESSING", providerOrders: [uncertain] }),
    ).toBeNull();
  });

  it.each([
    ["com externalOrderId", { ...uncertain, externalOrderId: "ext-1" }],
    ["com callback registrado", { ...uncertain, callbackEventCount: 1 }],
    ["sem lastError", po("PROCESSING")],
    ["com outro lastError", po("PROCESSING", { lastError: "PROVIDER_TIMEOUT" })],
  ] as Array<[string, ManualDeliveryProviderOrder]>)("PROCESSING %s continua bloqueado", (_, item) => {
    expect(manualDeliveryBlocker({ ...base, providerOrders: [item] })).toBe(
      "PROVIDER_ORDER_PROCESSING",
    );
  });

  it("incerto junto de outro PROCESSING comum → bloqueia", () => {
    expect(
      manualDeliveryBlocker({ ...base, providerOrders: [uncertain, po("PROCESSING")] }),
    ).toBe("PROVIDER_ORDER_PROCESSING");
  });

  it("incerto junto de COMPLETED → PROVIDER_ORDER_COMPLETED", () => {
    expect(
      manualDeliveryBlocker({ ...base, providerOrders: [uncertain, po("COMPLETED")] }),
    ).toBe("PROVIDER_ORDER_COMPLETED");
  });
});
