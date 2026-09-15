import { describe, expect, it } from "vitest";
import { assertCheckoutPrice, resolveTierPrice, resolveVisiblePrice } from "./commercial-pricing";

const protectedProduct = { priceCents: 2990, normalPriceCents: 2000, premiumPriceCents: 1000, priceVisibility: "LOGIN_REQUIRED" as const };

describe("preços comerciais por nível", () => {
  it("mantém preço público (distinto do técnico) para visitante", () => expect(resolveVisiblePrice({ ...protectedProduct, priceVisibility: "PUBLIC" }, null)).toMatchObject({ visible: true, priceCents: 2990 }));
  it("faz fallback para o preço público quando o técnico normal não está configurado", () => expect(resolveTierPrice({ ...protectedProduct, normalPriceCents: null }, { customerTier: "NORMAL" })).toBe(2990));
  it("não exibe preço público quando ele não está configurado", () => expect(resolveTierPrice({ priceCents: null, normalPriceCents: 2000, premiumPriceCents: 1000 }, null)).toBeNull());
  it("não expõe preço protegido para visitante", () => expect(resolveVisiblePrice(protectedProduct, null)).toEqual({ visible: false, priceCents: null, tier: null }));
  it("entrega preço normal ao técnico normal", () => expect(resolveVisiblePrice(protectedProduct, { customerTier: "NORMAL" })).toMatchObject({ visible: true, priceCents: 2000, tier: "NORMAL" }));
  it("entrega preço premium configurado", () => expect(resolveVisiblePrice(protectedProduct, { customerTier: "PREMIUM" })).toMatchObject({ visible: true, priceCents: 1000, tier: "PREMIUM" }));
  it("faz fallback premium para normal sem produzir zero", () => expect(resolveTierPrice({ ...protectedProduct, premiumPriceCents: null }, { customerTier: "PREMIUM" })).toBe(2000));
  it("resolve preços independentes por variante", () => expect(assertCheckoutPrice(protectedProduct, { priceCents: 5000, normalPriceCents: 4500, premiumPriceCents: 3500 }, { customerTier: "PREMIUM" })).toBe(3500));
  it("bloqueia checkout visitante quando o preço exige login", () => expect(() => assertCheckoutPrice(protectedProduct, null, null)).toThrow("LOGIN_REQUIRED_FOR_PRICE"));
  it("ignora valores de tier ou preço enviados pelo navegador", () => {
    const browserPayload = { tier: "PREMIUM", priceCents: 1 };
    expect(assertCheckoutPrice(protectedProduct, null, { customerTier: "NORMAL" })).toBe(2000);
    expect(browserPayload.priceCents).not.toBe(2000);
  });
});
