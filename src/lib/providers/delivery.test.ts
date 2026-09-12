import { describe, expect, it } from "vitest";
import { normalizeProviderReplay, parseProviderDelivery } from "./delivery";

const product = { name: "Produto teste" };
describe("generic provider delivery", () => {
  it("creates credential delivery", () => expect(parseProviderDelivery("Username: tech<br>Password: safe", product)).toMatchObject({ deliveryType: "CREDENTIALS", username: "tech", password: "safe" }));
  it("creates license and code deliveries", () => {
    expect(parseProviderDelivery("License: ABC-123", product)?.deliveryType).toBe("LICENSE");
    expect(parseProviderDelivery("Code: 9988", product)?.deliveryType).toBe("CODE");
  });
  it("creates text delivery without executing HTML", () => {
    const delivery = parseProviderDelivery("Ready &amp; safe <script>alert(1)</script>", product);
    expect(delivery).toMatchObject({ deliveryType: "TEXT" });
    expect(delivery?.deliveryFields[0].value).toContain("<script>");
  });
  it("creates multi-field delivery", () => expect(parseProviderDelivery("Server: EU\nExpiration: tomorrow\nCredits: 5", product)?.deliveryType).toBe("MULTI_FIELD"));
  it("normalizes CRLF, br variants and basic entities", () => expect(normalizeProviderReplay("A: 1\r\nB: 2<br/>C: &lt;ok&gt;")).toBe("A: 1\nB: 2\nC: <ok>"));
});
