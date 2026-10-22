import { describe, expect, it } from "vitest";
import {
  canPublishAutomatic,
  linkCandidateWhere,
  PROVIDER_LINK_PUBLICATION_ERROR,
  publicationError,
  VARIANT_PUBLICATION_ERROR,
} from "./admin-provider-link";

const link = (overrides: Record<string, unknown> = {}) => ({
  id: "pp1", productId: "p1", externalProductId: "2191", active: true, mode: "REAL" as const,
  providerCostCents: 520, technicalEligibility: "READY" as const,
  provider: { id: "hu", code: "heartunlocks", active: true },
  ...overrides,
});
const variant = (overrides: Record<string, unknown> = {}) => ({
  active: true, publicationBlocked: false, priceCents: 2990, normalPriceCents: 2990, ...overrides,
});

describe("linkCandidateWhere", () => {
  it("só itens ativos, REAL, READY, de fornecedor ativo de produção, sem variante e livres ou deste produto", () => {
    expect(linkCandidateWhere("p1")).toEqual({
      active: true,
      mode: "REAL",
      technicalEligibility: "READY",
      provider: { active: true, code: { notIn: ["mock-sandbox"] } },
      variants: { none: {} },
      OR: [{ productId: null }, { productId: "p1" }],
    });
  });
});

describe("canPublishAutomatic", () => {
  it("AUTOMATIC sem variantes publica com exatamente um vínculo direto elegível", () => {
    expect(canPublishAutomatic({ deliveryType: "AUTOMATIC", variants: [], providerProducts: [link()] })).toBe(true);
  });

  it.each([
    ["sem vínculo", []],
    ["dois vínculos elegíveis", [link(), link({ id: "pp2" })]],
    ["item inativo", [link({ active: false })]],
    ["item TEST", [link({ mode: "TEST" })]],
    ["item REVIEW", [link({ technicalEligibility: "REVIEW" })]],
    ["fornecedor inativo", [link({ provider: { id: "hu", code: "heartunlocks", active: false } })]],
    ["fornecedor de teste", [link({ provider: { id: "m", code: "mock-sandbox", active: true } })]],
  ])("AUTOMATIC sem variantes não publica: %s", (_case, providerProducts) => {
    expect(canPublishAutomatic({ deliveryType: "AUTOMATIC", variants: [], providerProducts })).toBe(false);
    expect(publicationError({ deliveryType: "AUTOMATIC", providerProducts })).toBe(PROVIDER_LINK_PUBLICATION_ERROR);
  });

  it("um item elegível e outro inoperante ainda resolve um único vínculo", () => {
    expect(canPublishAutomatic({ deliveryType: "AUTOMATIC", providerProducts: [link(), link({ id: "pp2", active: false })] })).toBe(true);
  });

  it.each(["MANUAL", "ON_REQUEST", "IMMEDIATE"])("entrega %s sem variantes não exige vínculo (regra atual)", (deliveryType) => {
    expect(canPublishAutomatic({ deliveryType })).toBe(true);
    expect(publicationError({ deliveryType })).toBeNull();
  });

  it("produto com variantes mantém a regra atual e ignora o vínculo direto", () => {
    expect(canPublishAutomatic({ deliveryType: "AUTOMATIC", variants: [variant()], providerProducts: [] })).toBe(true);
    const blocked = { deliveryType: "AUTOMATIC", variants: [variant({ active: false })], providerProducts: [link()] };
    expect(canPublishAutomatic(blocked)).toBe(false);
    expect(publicationError(blocked)).toBe(VARIANT_PUBLICATION_ERROR);
  });

  it("a mensagem diz em português que falta o produto do fornecedor", () => {
    expect(PROVIDER_LINK_PUBLICATION_ERROR).toMatch(/^Falta o produto do fornecedor/);
  });
});
