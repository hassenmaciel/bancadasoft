import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import CheckoutPanel from "./checkout-panel";
import type { ProductDTO } from "@/lib/dto";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// Plus 17,00 | PIX (menor Premium/Técnico) 20,00.
const product = (overrides: Partial<ProductDTO> = {}): ProductDTO => ({
  id: "p1", slug: "p", name: "Produto", description: "", longDescription: null, type: "TOOL", deliveryType: "MANUAL",
  deliveryEstimate: null, duration: null, imageUrl: null, downloadUrl: null, downloadLabel: null, status: "PUBLISHED",
  available: true, category: null, brand: null, checkoutFields: [], variants: [], minQuantity: 1, maxQuantity: 1,
  priceCents: 2000, priceVisible: true, priceTier: "PREMIUM_PLUS", priceMode: "pix",
  premiumPlus: { plusPriceCents: 1700, pixPriceCents: 2000 },
  ...overrides,
});
const render = (dto: ProductDTO, balanceCents: number | null) =>
  text(renderToStaticMarkup(<CheckoutPanel product={dto} balancePayment={balanceCents === null ? null : { balanceCents }} />));

describe("painel de checkout do PREMIUM_PLUS: saldo e PIX exclusivos, decididos pelo saldo", () => {
  it("saldo cobre o preço Plus: só 'pagar com saldo', sem botão PIX", () => {
    const body = render(product({ priceCents: 1700, priceMode: "balance" }), 1700);
    expect(body).toContain("PAGAR COM SALDO");
    expect(body).not.toContain("COMPRAR COM PIX");
  });

  it("saldo não cobre: só PIX (o bloqueio de PIX some), sem botão de saldo", () => {
    for (const balance of [1699, null]) {
      const body = render(product(), balance);
      expect(body).toContain("COMPRAR COM PIX");
      expect(body).not.toContain("PAGAR COM SALDO");
    }
  });

  it("sem preço Premium/Técnico e saldo que não cobre: nenhum botão de compra", () => {
    const body = render(product({ priceCents: null, premiumPlus: { plusPriceCents: 1700, pixPriceCents: null } }), 100);
    expect(body).not.toContain("COMPRAR COM PIX");
    expect(body).not.toContain("PAGAR COM SALDO");
  });

  it("NORMAL/PREMIUM com saldo liberado: PIX e saldo continuam lado a lado (inalterado)", () => {
    for (const priceTier of ["NORMAL", "PREMIUM"] as const) {
      const body = render(product({ priceTier, priceMode: undefined, premiumPlus: undefined }), 5000);
      expect(body).toContain("COMPRAR COM PIX");
      expect(body).toContain("PAGAR COM SALDO");
    }
  });
});
