import { describe, expect, it } from "vitest";
import {
  MANUAL_DELIVERY_HEARTUNLOCKS_CODE,
  manualDeliveryBlocker,
  type ManualDeliveryProviderOrder,
  type ManualDeliveryState,
} from "./manual-delivery-rules";
import { HEARTUNLOCKS_CODE } from "./providers/heartunlocks";

const po = (
  status: string,
  extra: Partial<ManualDeliveryProviderOrder> = {},
): ManualDeliveryProviderOrder => ({
  providerCode: "heartunlocks",
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

describe("manualDeliveryBlocker — HeartUnlocks em PROCESSING sem callback", () => {
  it("usa o mesmo código do adapter HeartUnlocks", () => {
    expect(MANUAL_DELIVERY_HEARTUNLOCKS_CODE).toBe(HEARTUNLOCKS_CODE);
  });

  it("libera PROCESSING incerto sem externalOrderId e sem callback (#9KJH34LN), como antes", () => {
    expect(
      manualDeliveryBlocker({ ...base, orderStatus: "PROCESSING", providerOrders: [uncertain] }),
    ).toBeNull();
  });

  it.each([
    ["aceito pelo gateway (202): externalOrderId, lastError nulo", po("PROCESSING", { externalOrderId: "I26101901" })],
    ["incerto e com externalOrderId", { ...uncertain, externalOrderId: "I26101901" }],
  ] as Array<[string, ManualDeliveryProviderOrder]>)("libera %s, sem callback", (_, item) => {
    expect(
      manualDeliveryBlocker({ ...base, orderStatus: "PROCESSING", providerOrders: [item] }),
    ).toBeNull();
  });

  it.each([
    ["sem lastError e sem externalOrderId (criação em andamento)", po("PROCESSING")],
    ["com outro lastError e sem externalOrderId", po("PROCESSING", { lastError: "PROVIDER_TIMEOUT" })],
    ["incerto com callback registrado", { ...uncertain, callbackEventCount: 1 }],
    ["com externalOrderId e callback registrado", po("PROCESSING", { externalOrderId: "I26101901", callbackEventCount: 1 })],
    ["AdClean com externalOrderId", po("PROCESSING", { providerCode: "adclean", externalOrderId: "bancadasoft:order-1" })],
    ["AdClean incerto", { ...uncertain, providerCode: "adclean" }],
    ["AdClean licença com externalOrderId", po("PROCESSING", { providerCode: "adclean-license", externalOrderId: "x" })],
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

  it("HeartUnlocks com externalOrderId em pedido já DELIVERED → ORDER_ALREADY_DELIVERED", () => {
    expect(
      manualDeliveryBlocker({
        ...base,
        orderStatus: "DELIVERED",
        providerOrders: [po("PROCESSING", { externalOrderId: "I26101901" })],
      }),
    ).toBe("ORDER_ALREADY_DELIVERED");
  });

  it("incerto junto de COMPLETED → PROVIDER_ORDER_COMPLETED", () => {
    expect(
      manualDeliveryBlocker({ ...base, providerOrders: [uncertain, po("COMPLETED")] }),
    ).toBe("PROVIDER_ORDER_COMPLETED");
  });
});
