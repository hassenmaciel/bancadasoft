import { describe, expect, it } from "vitest";
import { classifyProviderProduct, dynamicFieldSchema, normalizeProviderField, validateDynamicFieldValues } from "./automation";

const contract = (fields: Array<{ name: string; type?: string; required?: boolean }>, label = "Tool rent instant auto") => classifyProviderProduct({
  providerCode: "heartunlocks",
  label,
  providerCostCents: 28,
  metadata: { categoryName: "Id Password Instant Auto", requiredFields: fields },
});

describe("provider product automation", () => {
  it("classifies quantity-only credential contracts without UUID rules", () => {
    expect(contract([{ name: "Quantity", type: "number" }])).toMatchObject({ automationClass: "AUTO_CREDENTIAL", technicalEligibility: "READY", expectedDeliveryType: "CREDENTIALS" });
  });
  it("keeps the signature stable for equivalent contracts", () => {
    expect(contract([{ name: "Quantity" }], "Unlock rent").contractSignature).toBe(contract([{ name: "Quantity" }], "AMT rent").contractSignature);
  });
  it.each([
    ["IMEI", "imei", "imei"], ["User Name", "username", "username"], ["Email Address", "email", "email"], ["Serial Number", "serial", "serial"],
  ])("normalizes %s", (name, key, type) => expect(normalizeProviderField(name)).toMatchObject({ key, type }));
  it("classifies UltraViewer fields as remote sessions", () => {
    expect(contract([{ name: "Enter Ultra Viewer ID" }], "Remote service").automationClass).toBe("REMOTE_SESSION");
  });
  it("builds customer-visible fields while hiding Quantity", () => {
    const schema = dynamicFieldSchema({ requiredFields: [{ name: "Quantity" }, { name: "IMEI" }] });
    expect(schema.find((field) => field.key === "quantity")?.customerVisible).toBe(false);
    expect(schema.find((field) => field.key === "imei")?.customerVisible).toBe(true);
  });
  it("defaults Quantity to one and validates provider inputs", () => {
    const schema = dynamicFieldSchema({ requiredFields: [{ name: "Quantity" }, { name: "IMEI" }] });
    expect(validateDynamicFieldValues(schema, { imei: "123456789012345" })).toEqual({ Quantity: 1, IMEI: "123456789012345" });
  });
  it("sends required provider fields and rejects an absent required value", () => {
    const schema = dynamicFieldSchema({ requiredFields: [{ name: "Username" }, { name: "Email" }, { name: "Serial" }] });
    expect(validateDynamicFieldValues(schema, { username: "tech", email: "test@example.com", serial: "ABC123" })).toEqual({ Username: "tech", Email: "test@example.com", Serial: "ABC123" });
    expect(() => validateDynamicFieldValues(schema, { username: "tech" })).toThrow("PROVIDER_FIELD_REQUIRED:email");
  });
  it("preserves surrounding spaces in providerFieldName while key and label stay normalized", () => {
    expect(normalizeProviderField(" Serial ")).toMatchObject({ key: "serial", type: "serial", label: "Serial", placeholder: "Informe Serial", providerFieldName: " Serial " });
    const schema = dynamicFieldSchema({ requiredFields: [{ name: "Serial " }] });
    expect(schema[0]).toMatchObject({ key: "serial", label: "Serial", providerFieldName: "Serial " });
    expect(validateDynamicFieldValues(schema, { serial: "DX3FQCY40F0X" })).toEqual({ "Serial ": "DX3FQCY40F0X" });
  });
  // Contrato de envio dos produtos Fenix Tool Pro e Moto M Tool (fieldSchema do
  // banco): o valor sai sob providerFieldName, independente do rótulo exibido.
  it("sends Fenix user, Moto M HWID + Quantity and Moto M EMAIL under providerFieldName", () => {
    const fenix = dynamicFieldSchema({ requiredFields: [{ name: "user" }] });
    expect(fenix).toMatchObject([{ key: "username", type: "username", providerFieldName: "user" }]);
    expect(validateDynamicFieldValues(fenix, { username: "tecnico01" })).toEqual({ user: "tecnico01" });
    const activation = dynamicFieldSchema({ requiredFields: [{ name: "Quantity" }, { name: "HWID" }] });
    expect(activation.find((field) => field.key === "hwid")).toMatchObject({ type: "text", providerFieldName: "HWID" });
    expect(validateDynamicFieldValues(activation, { hwid: "ABC-123-XYZ" })).toEqual({ Quantity: 1, HWID: "ABC-123-XYZ" });
    const renew = dynamicFieldSchema({ requiredFields: [{ name: "EMAIL" }] });
    expect(renew).toMatchObject([{ key: "email", type: "email", providerFieldName: "EMAIL" }]);
    expect(validateDynamicFieldValues(renew, { email: "conta@motom.com" })).toEqual({ EMAIL: "conta@motom.com" });
    expect(() => validateDynamicFieldValues(renew, { email: "nao-e-email" })).toThrow("PROVIDER_FIELD_INVALID:email");
  });
  it("keeps incomplete contracts under manual review", () => {
    expect(classifyProviderProduct({ providerCode: "heartunlocks", label: "Unknown", providerCostCents: null, metadata: {} })).toMatchObject({ automationClass: "MANUAL_REVIEW", technicalEligibility: "REVIEW" });
  });
});
