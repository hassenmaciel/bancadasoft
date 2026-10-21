import { describe, expect, it } from "vitest";
import { CONFIRM_ENV, EXPECTED_CREDITS, planFixes, resolveMode, revertSql } from "./fix-topup-prices.mjs";

const variant = (id, prices) => ({
  id, code: id, priceCents: null, manualPriceCents: null, normalPriceCents: null, premiumPriceCents: null, premiumPlusPriceCents: null, ...prices,
});
const aligned = (credit) => ({ priceCents: credit, manualPriceCents: credit, normalPriceCents: credit });
const row = (externalProductId, credit, prices) => ({
  externalProductId, metadata: { creditAmountCents: credit }, variant: variant(`v-${externalProductId}`, prices),
});
// Cenário relatado: topup-1000 com priceCents órfão (1000) e crédito 1500
// (os demais campos são ilustrativos).
const reported = () => [
  row("topup-1000", 1500, { priceCents: 1000, manualPriceCents: 1000, normalPriceCents: 1500 }),
  row("topup-3000", 3000, aligned(3000)),
  row("topup-5000", 5000, aligned(5000)),
];

describe("fix-topup-prices (P3)", () => {
  it("créditos esperados dos três pacotes", () => {
    expect(EXPECTED_CREDITS).toEqual({ "topup-1000": 1500, "topup-3000": 3000, "topup-5000": 5000 });
  });

  it("corrige só o priceCents/manualPriceCents órfãos do topup-1000; 3000 e 5000 conferidos sem escrita", () => {
    const plan = planFixes(reported());
    expect(plan.problems).toEqual([]);
    expect(plan.updates).toEqual([{
      externalProductId: "topup-1000",
      variantId: "v-topup-1000",
      variantCode: "v-topup-1000",
      before: { priceCents: 1000, manualPriceCents: 1000 },
      changes: { priceCents: 1500, manualPriceCents: 1500 },
    }]);
  });

  it("idempotente: depois de aplicado, nada a fazer", () => {
    const rows = reported();
    rows[0].variant = { ...rows[0].variant, priceCents: 1500, manualPriceCents: 1500 };
    expect(planFixes(rows)).toEqual({ problems: [], updates: [] });
  });

  it("preço por tier divergente do crédito é anulado; igual ao crédito é mantido", () => {
    const plan = planFixes([
      row("topup-1000", 1500, { ...aligned(1500), premiumPriceCents: 1400, premiumPlusPriceCents: 1500 }),
      row("topup-3000", 3000, aligned(3000)),
      row("topup-5000", 5000, aligned(5000)),
    ]);
    expect(plan.updates[0].changes).toEqual({ premiumPriceCents: null });
  });

  it("nunca altera crédito: crédito inesperado, pacote ausente ou sem variante abortam", () => {
    const wrongCredit = reported();
    wrongCredit[0] = row("topup-1000", 1000, aligned(1000));
    expect(planFixes(wrongCredit).problems[0]).toMatch(/topup-1000: crédito no metadata é 1000, esperado 1500/);
    expect(planFixes(reported().slice(1)).problems[0]).toMatch(/topup-1000 não encontrado/);
    const noVariant = reported();
    noVariant[2] = { ...noVariant[2], variant: null };
    expect(planFixes(noVariant).problems).toEqual(["topup-5000: nenhuma ProductVariant vinculada"]);
  });

  it("SQL de reversão restaura os valores anteriores", () => {
    expect(revertSql(planFixes(reported()).updates)).toBe(
      `UPDATE "ProductVariant" SET "priceCents" = 1000, "manualPriceCents" = 1000 WHERE id = 'v-topup-1000';`,
    );
  });

  it("--apply exige confirmação explícita; padrão é DRY_RUN", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(() => resolveMode(["--apply"], {})).toThrow(CONFIRM_ENV);
    expect(resolveMode(["--apply"], { [CONFIRM_ENV]: "SIM" })).toBe("APPLY");
  });
});
