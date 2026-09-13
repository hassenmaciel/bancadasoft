import { describe, expect, it } from "vitest";
import {
  customerDelivery,
  customerOrderState,
  deliveryHeading,
  hasCustomerDelivery,
} from "./customer-delivery";

describe("customer delivery presentation", () => {
  it("shows payment confirmed before processing", () =>
    expect(customerOrderState("PAID", "PAID")).toBe("Pagamento confirmado"));
  it("shows release processing", () =>
    expect(customerOrderState("PROCESSING", "PAID", "PROCESSING")).toBe(
      "Processando liberação",
    ));
  it("shows released access only for delivered order", () =>
    expect(customerOrderState("DELIVERED", "PAID", "FULFILLED")).toBe(
      "Acesso liberado",
    ));
  it("shows actionable failure", () =>
    expect(customerOrderState("FAILED", "PAID", "FAILED")).toBe(
      "Falha — requer atenção",
    ));

  it.each([
    ["CREDENTIALS", { deliveryType: "CREDENTIALS", username: "user", password: "pass" }],
    ["CODE", { deliveryType: "CODE", credential: "SAFE-CODE" }],
    ["LICENSE", { deliveryType: "LICENSE", credential: "SAFE-LICENSE" }],
    ["TEXT", { deliveryType: "TEXT", deliveryFields: [{ key: "text", label: "Resultado", value: "Concluído", sensitive: false }] }],
    ["MULTI_FIELD", { deliveryType: "MULTI_FIELD", deliveryFields: [{ key: "server", label: "Servidor", value: "EU", sensitive: false }] }],
  ])("accepts a valid %s delivery", (_, delivery) => {
    expect(hasCustomerDelivery(delivery)).toBe(true);
    expect(customerDelivery(delivery)?.deliveryType).toBe(delivery.deliveryType);
  });

  it("rejects incomplete credentials and malformed deliveries", () => {
    expect(customerDelivery({ deliveryType: "CREDENTIALS", username: "user" })).toBeNull();
    expect(customerDelivery({ instructions: "text" })).toBeNull();
    expect(customerDelivery({ deliveryType: "CODE" })).toBeNull();
  });

  it("returns only the safe customer delivery contract", () => {
    const delivery = customerDelivery({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
      providerSecret: "must-not-leak",
      rawReplay: "must-not-leak",
    });
    expect(delivery).toEqual({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
    });
    expect(JSON.stringify(delivery)).not.toMatch(/providerSecret|rawReplay/);
  });

  it("uses a native title for each delivery type", () => {
    expect(deliveryHeading("CODE")).toBe("Código liberado");
    expect(deliveryHeading("LICENSE")).toBe("Licença liberada");
    expect(deliveryHeading("TEXT")).toBe("Resultado disponível");
    expect(deliveryHeading("MULTI_FIELD")).toBe("Resultado disponível");
    expect(deliveryHeading("CREDENTIALS")).toBe("Acesso liberado");
  });
});
