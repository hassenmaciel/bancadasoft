// Alinha os preços gravados das variantes da "Recarga de Saldo" ao valor
// creditado de cada pacote (ProviderProduct.metadata.creditAmountCents).
//
// Desde o fix(topup) o checkout e a exibição de BALANCE_TOPUP usam SEMPRE o
// crédito do pacote (assertCheckoutPrice / productDto), então este ajuste não
// muda o que o cliente paga: só elimina o priceCents órfão (topup-1000 com
// priceCents 1000 e crédito 1500) para o Admin e qualquer leitura futura.
//
// Por variante: priceCents, manualPriceCents e normalPriceCents = crédito;
// premiumPriceCents/premiumPlusPriceCents = null quando divergem do crédito.
// Idempotente: se tudo já está alinhado, não escreve nada. Nunca altera o
// crédito (metadata): se o crédito não for o esperado, aborta.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env scripts/fix-topup-prices.mjs
//   ESCRITA (somente com aprovação explícita; tudo numa única transação):
//     CONFIRM_FIX_TOPUP_PRICES=SIM node --env-file=.env scripts/fix-topup-prices.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const CONFIRM_ENV = "CONFIRM_FIX_TOPUP_PRICES";
export const PROVIDER_CODE = "internal-balance";

// externalProductId -> crédito esperado (centavos).
export const EXPECTED_CREDITS = {
  "topup-1000": 1500,
  "topup-3000": 3000,
  "topup-5000": 5000,
};

const PRICE_FIELDS = ["priceCents", "manualPriceCents", "normalPriceCents", "premiumPriceCents", "premiumPlusPriceCents"];

function creditOf(metadata) {
  const value = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata.creditAmountCents : undefined;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function targetPrices(variant, creditCents) {
  return {
    priceCents: creditCents,
    manualPriceCents: creditCents,
    normalPriceCents: creditCents,
    premiumPriceCents: variant.premiumPriceCents === creditCents ? creditCents : null,
    premiumPlusPriceCents: variant.premiumPlusPriceCents === creditCents ? creditCents : null,
  };
}

// rows: ProviderProduct do provider interno com a variante vinculada (ou null).
// Devolve { problems, updates }. Com problemas, nada deve ser escrito.
export function planFixes(rows) {
  const problems = [];
  const updates = [];
  for (const [externalId, expected] of Object.entries(EXPECTED_CREDITS)) {
    const row = rows.find((candidate) => candidate.externalProductId === externalId);
    if (!row) {
      problems.push(`ProviderProduct ${externalId} não encontrado no provider ${PROVIDER_CODE}`);
      continue;
    }
    const credit = creditOf(row.metadata);
    if (credit !== expected) {
      problems.push(`${externalId}: crédito no metadata é ${credit ?? "inválido"}, esperado ${expected} (o script não altera crédito)`);
      continue;
    }
    if (!row.variant) {
      problems.push(`${externalId}: nenhuma ProductVariant vinculada`);
      continue;
    }
    const target = targetPrices(row.variant, credit);
    const changes = Object.fromEntries(
      PRICE_FIELDS.filter((field) => row.variant[field] !== target[field]).map((field) => [field, target[field]]),
    );
    if (Object.keys(changes).length)
      updates.push({
        externalProductId: externalId,
        variantId: row.variant.id,
        variantCode: row.variant.code,
        before: Object.fromEntries(Object.keys(changes).map((field) => [field, row.variant[field]])),
        changes,
      });
  }
  return { problems, updates };
}

const sqlValue = (value) => (value === null || value === undefined ? "NULL" : String(Number(value)));

export function revertSql(updates) {
  return updates
    .map((update) => {
      const sets = Object.entries(update.before).map(([field, value]) => `"${field}" = ${sqlValue(value)}`).join(", ");
      return `UPDATE "ProductVariant" SET ${sets} WHERE id = '${update.variantId}';`;
    })
    .join("\n");
}

export function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

const variantSelect = {
  id: true,
  code: true,
  priceCents: true,
  manualPriceCents: true,
  normalPriceCents: true,
  premiumPriceCents: true,
  premiumPlusPriceCents: true,
};

async function loadRows(db) {
  const rows = await db.providerProduct.findMany({
    where: { provider: { code: PROVIDER_CODE }, externalProductId: { in: Object.keys(EXPECTED_CREDITS) } },
    select: { externalProductId: true, metadata: true, variants: { select: variantSelect } },
  });
  // ProductVariant.providerProductId é único: no máximo uma variante por pacote.
  return rows.map(({ variants, ...row }) => ({ ...row, variant: variants[0] ?? null }));
}

const line = (text = "") => console.log(text);

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    line(`MODE: ${mode}${mode === "DRY_RUN" ? " (somente SELECTs; nenhuma escrita)" : " (escreve; uma única transação)"}`);
    const rows = await loadRows(db);
    for (const row of rows) line(`  atual: ${row.externalProductId} crédito=${creditOf(row.metadata)} variante=${JSON.stringify(row.variant)}`);
    const plan = planFixes(rows);
    if (plan.problems.length) {
      for (const problem of plan.problems) line(`  [FALHOU] ${problem}`);
      line("\nABORTADO: nada foi alterado.");
      return;
    }
    if (!plan.updates.length) {
      line("\n[OK] todos os pacotes já estão alinhados ao crédito. Nada a fazer.");
      return;
    }
    line("\n-- Plano --");
    for (const update of plan.updates) line(`  ${update.externalProductId} (${update.variantCode}): ${JSON.stringify(update.before)} -> ${JSON.stringify(update.changes)}`);
    line("\n-- SQL de reversão --");
    line(revertSql(plan.updates));
    if (mode !== "APPLY") {
      line(`\n[DRY-RUN] nada foi escrito. Próximo passo (só com aprovação): --apply com ${CONFIRM_ENV}=SIM.`);
      return;
    }
    await db.$transaction(async (tx) => {
      // Revalida dentro da transação: aplica só se o plano não mudou.
      const fresh = planFixes(await loadRows(tx));
      if (fresh.problems.length || JSON.stringify(fresh.updates) !== JSON.stringify(plan.updates))
        throw new Error("ABORTADO (revalidação): os dados mudaram desde o plano.");
      for (const update of plan.updates)
        await tx.productVariant.update({ where: { id: update.variantId }, data: update.changes });
    });
    const after = planFixes(await loadRows(db));
    line(`\n[${after.updates.length === 0 && after.problems.length === 0 ? "OK" : "FALHOU"}] conferência pós-escrita: ${JSON.stringify(after)}`);
  } finally {
    await db.$disconnect();
  }
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((error) => {
    console.error("ERRO:", error.message);
    process.exitCode = 1;
  });
}
