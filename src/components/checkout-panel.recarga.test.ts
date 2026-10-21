import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lockedCheckoutVariantId } from "@/lib/product-variants";

// O formulário do checkout só existe com o modal aberto (estado do cliente),
// então a regra do seletor é testada pela função que o painel usa e pelo
// trecho do painel que a aplica.
const topupVariants = [
  { id: "v15", priceCents: 1500 },
  { id: "v30", priceCents: 3000 },
  { id: "free", priceCents: 1500 },
];
const topup = { type: "BALANCE_TOPUP", variants: topupVariants };
const tool = { type: "TOOL", variants: [{ id: "a", priceCents: 1000 }, { id: "b", priceCents: 2000 }] };

describe("seletor de variante no checkout da recarga", () => {
  it("recarga com ?variante= válido: sem seletor, a variante enviada é sempre a da URL", () => {
    expect(lockedCheckoutVariantId(topup, "v30")).toBe("v30");
    expect(lockedCheckoutVariantId(topup, "free")).toBe("free");
  });

  it("recarga sem ?variante= ou com id inválido/sem preço: seletor continua", () => {
    expect(lockedCheckoutVariantId(topup, null)).toBeNull();
    expect(lockedCheckoutVariantId(topup, undefined)).toBeNull();
    expect(lockedCheckoutVariantId(topup, "")).toBeNull();
    expect(lockedCheckoutVariantId(topup, "outra")).toBeNull();
    expect(lockedCheckoutVariantId({ type: "BALANCE_TOPUP", variants: [{ id: "v15", priceCents: null }] }, "v15")).toBeNull();
    // Variante única mas pedida outra: pré-seleciona a única, sem esconder o seletor.
    expect(lockedCheckoutVariantId({ type: "BALANCE_TOPUP", variants: [{ id: "v15", priceCents: 1500 }] }, "outra")).toBeNull();
  });

  it("produto comum com 2+ variantes continua com seletor, mesmo com ?variante= válido", () => {
    expect(lockedCheckoutVariantId(tool, "b")).toBeNull();
    expect(lockedCheckoutVariantId(tool, null)).toBeNull();
  });

  it("o painel esconde o seletor só pela variante travada e envia essa variante", () => {
    const source = readFileSync(path.resolve(__dirname, "checkout-panel.tsx"), "utf8");
    expect(source).toContain("const lockedVariantId = lockedCheckoutVariantId(product, initialVariantId);");
    expect(source).toContain("const variantId = lockedVariantId ?? chosenVariantId;");
    expect(source).toContain("{product.variants.length > 0 && !lockedVariantId && (");
    expect(source).toContain("variantId: product.variants.length ? variantId : undefined,");
  });
});
