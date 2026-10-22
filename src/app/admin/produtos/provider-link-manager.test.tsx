import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ProductForm from "./product-form";
import { adminProductDto, type AdminProductDTO } from "@/lib/admin-catalog";

const now = new Date("2026-10-22T12:00:00Z");
const category = { id: "cat-1", name: "Ferramentas", slug: "ferramentas", active: true, createdAt: now, updatedAt: now };
const base = adminProductDto({
  id: "p1", slug: "octoplus", name: "Octoplus", description: "Aluguel", longDescription: null,
  type: "RENTAL", deliveryType: "AUTOMATIC", deliveryEstimate: null, searchTerms: "", duration: null,
  imageUrl: null, downloadUrl: null, downloadLabel: null,
  priceCents: 4500, priceVisibility: "PUBLIC", normalPriceCents: 4500, premiumPriceCents: null, premiumPlusPriceCents: null, resellerPriceCents: null,
  costCents: null, pricingMode: "MANUAL", manualPriceCents: 4500, suggestedPriceCents: null, pricingStatus: "MANUAL",
  pricingComputedAt: null, featured: false, sortOrder: 0, status: "PAUSED", available: true,
  minQuantity: 1, maxQuantity: 1, acceptsSuccessWithoutText: false,
  categoryId: category.id, brandId: null, createdAt: now, updatedAt: now, category, brand: null,
});
const link = {
  id: "pp1", externalProductId: "2191", label: "Octoplus Full Digital 1 Day License", providerCostCents: 520, currency: "USD",
  active: true, mode: "REAL", metadata: null, lastSyncedAt: null, syncStatus: "SYNCED", updatedAt: now.toISOString(),
  automationClass: "AUTO_CREDENTIAL", technicalEligibility: "READY", homologationStatus: "CLASS_VALIDATED",
  contractSignature: null, fieldSchema: null, expectedDeliveryType: "CREDENTIALS",
  provider: { id: "hu", name: "HeartUnlocks", code: "heartunlocks", active: true },
} satisfies AdminProductDTO["providerProducts"][number];
const options = [{ id: "pp2", label: "Borneo Schematics 1 User Activation Code [3 Months] · ID 836 · US$ 11,40" }];
const render = (product: AdminProductDTO) =>
  renderToStaticMarkup(<ProductForm product={product} categories={[category]} brands={[]} providerLinkOptions={options} />);

describe("Seção “Produto do fornecedor” no formulário de produto", () => {
  it("produto sem vínculo: mostra o seletor com nome, ID externo e custo", () => {
    const html = render(base);
    expect(html).toContain("<legend>Produto do fornecedor</legend>");
    expect(html).toContain("Nenhum produto do fornecedor vinculado");
    expect(html).toContain("Borneo Schematics 1 User Activation Code [3 Months] · ID 836 · US$ 11,40");
    expect(html).toContain(">Vincular</button>");
    expect(html).not.toContain("Remover vínculo");
  });

  it("produto vinculado: mostra o vínculo atual, trocar e remover", () => {
    const html = render({ ...base, providerProducts: [link] });
    expect(html).toContain("Vínculo atual");
    expect(html).toContain("Octoplus Full Digital 1 Day License");
    expect(html).toContain("2191");
    expect(html).toMatch(/US\$\s5,20/);
    expect(html).toContain("Trocar vínculo");
    expect(html).toContain("Remover vínculo");
  });

  it("publicado e automático: remoção desabilitada com aviso", () => {
    const html = render({ ...base, status: "PUBLISHED", providerProducts: [link] });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Remover vínculo<\/button>/);
    expect(html).toContain("pause o produto antes de remover o vínculo");
  });

  it("produto com variantes não mostra a seção (o item é escolhido em cada variante)", () => {
    const variant: AdminProductDTO["variants"][number] = {
      id: "v1", name: "Premium", code: "premium", active: true, sortOrder: 0, priceCents: 2990, pricingMode: "MANUAL",
      manualPriceCents: 2990, normalPriceCents: 2990, premiumPriceCents: null, premiumPlusPriceCents: null,
      suggestedPriceCents: null, pricingStatus: "MANUAL", publicationBlocked: false, holdReason: null,
      providerProduct: { id: "pp9", externalProductId: "2999", label: "Griffin", providerCostCents: 900, currency: "USD", active: true, provider: { id: "hu", name: "HeartUnlocks", active: true } },
    };
    const html = render({ ...base, variants: [variant] });
    expect(html).not.toContain("<legend>Produto do fornecedor</legend>");
    expect(html).toContain("<legend>Variantes comerciais</legend>");
  });

  it("produto novo (sem id) não mostra a seção", () => {
    const html = renderToStaticMarkup(<ProductForm categories={[category]} brands={[]} />);
    expect(html).not.toContain("<legend>Produto do fornecedor</legend>");
  });
});
