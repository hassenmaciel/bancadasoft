import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ProductForm from "./product-form";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { optionalCentsToInput, optionalInputToCents } from "@/lib/admin-price-input";

const now = new Date("2026-09-25T12:00:00Z");
const category = { id: "cat-1", name: "Ferramentas", slug: "ferramentas", active: true, createdAt: now, updatedAt: now };
const source = (resellerPriceCents: number | null) => ({
  id: "p1", slug: "adclean", name: "AdClean", description: "Ticket", longDescription: null,
  type: "TOOL" as const, deliveryType: "AUTOMATIC" as const, deliveryEstimate: null, searchTerms: "", duration: null,
  imageUrl: null, downloadUrl: null, downloadLabel: null,
  priceCents: 2000, priceVisibility: "LOGIN_REQUIRED" as const, normalPriceCents: 2000, premiumPriceCents: 1000, premiumPlusPriceCents: null, resellerPriceCents,
  costCents: null, pricingMode: "MANUAL" as const, manualPriceCents: 2000, suggestedPriceCents: null, pricingStatus: "MANUAL" as const,
  pricingComputedAt: null, featured: false, sortOrder: 0, status: "DRAFT" as const, available: false,
  minQuantity: 1, maxQuantity: 1, acceptsSuccessWithoutText: false,
  categoryId: category.id, brandId: null, createdAt: now, updatedAt: now, category, brand: null,
});
const resellerInput = (html: string) => html.match(/Preço de revenda \(R\$\)<input[^>]*>/)?.[0] ?? "";
// Payload mínimo no formato que o formulário envia (ver product-form.tsx).
const payload = (resellerPriceCents: number | null) => ({
  name: "AdClean", slug: "adclean", description: "Ticket", type: "TOOL", deliveryType: "AUTOMATIC",
  priceCents: 2000, priceVisibility: "LOGIN_REQUIRED", normalPriceCents: 2000, premiumPriceCents: 1000,
  resellerPriceCents, pricingMode: "MANUAL", manualPriceCents: 2000, categoryId: "cat-1", status: "DRAFT", available: false,
});

describe("Preço de revenda no formulário de produto", () => {
  it("conversão reais <-> centavos igual à do Preço Premium: vazio = null", () => {
    expect(optionalInputToCents("")).toBeNull();
    expect(optionalInputToCents("25")).toBe(2500);
    expect(optionalInputToCents("19.99")).toBe(1999);
    expect(optionalCentsToInput(null)).toBe("");
    expect(optionalCentsToInput(undefined)).toBe("");
    expect(optionalCentsToInput(1999)).toBe("19.99");
    for (const cents of [100, 1999, 2500]) expect(optionalInputToCents(optionalCentsToInput(cents))).toBe(cents);
  });

  it("recarrega o valor salvo (DTO -> campo) e mostra vazio quando é null", () => {
    const withPrice = renderToStaticMarkup(<ProductForm product={adminProductDto(source(2500))} categories={[category]} brands={[]} />);
    expect(resellerInput(withPrice)).toContain('value="25"');
    const withoutPrice = renderToStaticMarkup(<ProductForm product={adminProductDto(source(null))} categories={[category]} brands={[]} />);
    expect(resellerInput(withoutPrice)).toContain('value=""');
    expect(resellerInput(withoutPrice)).toContain('placeholder="Vazio = não vendido a revendedor"');
  });

  it("o DTO do Admin carrega resellerPriceCents (nulo e com valor)", () => {
    expect(adminProductDto(source(2500)).resellerPriceCents).toBe(2500);
    expect(adminProductDto(source(null)).resellerPriceCents).toBeNull();
  });

  it("o schema de gravação aceita e preserva o campo (nulo, com valor ou ausente) e recusa zero/fração", () => {
    const parse = (value: unknown) => productInputSchema.safeParse({ ...payload(null), resellerPriceCents: value });
    expect(productInputSchema.parse(payload(2500)).resellerPriceCents).toBe(2500);
    expect(productInputSchema.parse(payload(null)).resellerPriceCents).toBeNull();
    const { resellerPriceCents: _omitted, ...withoutField } = payload(null);
    expect(productInputSchema.parse(withoutField)).not.toHaveProperty("resellerPriceCents");
    expect(parse(0).success).toBe(false);
    expect(parse(10.5).success).toBe(false);
  });
});

describe("Tipo Recarga de saldo no formulário de produto", () => {
  it("oferece BALANCE_TOPUP como opção e o mantém selecionado ao editar um produto desse tipo", () => {
    const html = renderToStaticMarkup(<ProductForm product={adminProductDto({ ...source(null), type: "BALANCE_TOPUP" })} categories={[category]} brands={[]} />);
    expect(html).toContain('<option value="BALANCE_TOPUP" selected="">Recarga de saldo</option>');
    const blank = renderToStaticMarkup(<ProductForm categories={[category]} brands={[]} />);
    expect(blank).toContain('<option value="BALANCE_TOPUP">Recarga de saldo</option>');
  });

  it("o schema de gravação aceita BALANCE_TOPUP", () => {
    expect(productInputSchema.parse({ ...payload(null), type: "BALANCE_TOPUP" }).type).toBe("BALANCE_TOPUP");
  });
});

describe("Quantidade por pedido e confirmação sem texto no formulário de produto", () => {
  const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

  it("carrega os valores atuais do produto (Phoenix 5/100/marcado)", () => {
    const html = renderToStaticMarkup(<ProductForm product={adminProductDto({ ...source(null), type: "CREDIT", minQuantity: 5, maxQuantity: 100, acceptsSuccessWithoutText: true })} categories={[category]} brands={[]} />);
    expect(input(html, "minQuantity")).toContain('value="5"');
    expect(input(html, "maxQuantity")).toContain('value="100"');
    expect(input(html, "minQuantity")).toContain('max="100"');
    expect(input(html, "acceptsSuccessWithoutText")).toContain('checked=""');
    expect(html).toContain("Aceitar confirmação do fornecedor sem texto (créditos)");
    expect(html).toContain("&#x27;success&#x27; sem texto conta como entregue e gera nota de revisão manual.");
    expect(html).toContain("Máximo 100.");
  });

  it("produto novo: 1, 1 e desmarcado", () => {
    const html = renderToStaticMarkup(<ProductForm categories={[category]} brands={[]} />);
    expect(input(html, "minQuantity")).toContain('value="1"');
    expect(input(html, "maxQuantity")).toContain('value="1"');
    expect(input(html, "acceptsSuccessWithoutText")).not.toContain("checked");
  });

  it("o DTO do Admin carrega os três campos", () => {
    expect(adminProductDto({ ...source(null), minQuantity: 5, maxQuantity: 100, acceptsSuccessWithoutText: true })).toMatchObject({ minQuantity: 5, maxQuantity: 100, acceptsSuccessWithoutText: true });
  });

  it("schema: campos ausentes não aparecem no resultado (não alteram o produto)", () => {
    const parsed = productInputSchema.parse(payload(null));
    expect(parsed).not.toHaveProperty("minQuantity");
    expect(parsed).not.toHaveProperty("maxQuantity");
    expect(parsed).not.toHaveProperty("acceptsSuccessWithoutText");
  });

  it("schema: aceita a faixa 1..100 com máximo >= mínimo", () => {
    expect(productInputSchema.parse({ ...payload(null), minQuantity: 5, maxQuantity: 100, acceptsSuccessWithoutText: true })).toMatchObject({ minQuantity: 5, maxQuantity: 100, acceptsSuccessWithoutText: true });
    expect(productInputSchema.parse({ ...payload(null), minQuantity: 1, maxQuantity: 1, acceptsSuccessWithoutText: false })).toMatchObject({ minQuantity: 1, maxQuantity: 1, acceptsSuccessWithoutText: false });
    expect(productInputSchema.parse({ ...payload(null), minQuantity: 7, maxQuantity: 7 })).toMatchObject({ minQuantity: 7, maxQuantity: 7 });
  });

  it.each([
    ["mínimo 0", { minQuantity: 0, maxQuantity: 1 }, "A quantidade mínima é 1."],
    ["máximo 101 (teto do Heart)", { minQuantity: 1, maxQuantity: 101 }, "A quantidade máxima é 100."],
    ["fração", { minQuantity: 1.5, maxQuantity: 2 }, "A quantidade deve ser um número inteiro."],
    ["máximo < mínimo", { minQuantity: 10, maxQuantity: 5 }, "A quantidade máxima deve ser maior ou igual à mínima."],
    ["só o mínimo", { minQuantity: 5 }, "Informe a quantidade mínima e a máxima juntas."],
    ["só o máximo", { maxQuantity: 5 }, "Informe a quantidade mínima e a máxima juntas."],
  ])("schema recusa %s com mensagem em português", (_label, fields, message) => {
    const result = productInputSchema.safeParse({ ...payload(null), ...fields });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("schema recusa acceptsSuccessWithoutText não booleano", () => {
    expect(productInputSchema.safeParse({ ...payload(null), acceptsSuccessWithoutText: "on" }).success).toBe(false);
  });
});
