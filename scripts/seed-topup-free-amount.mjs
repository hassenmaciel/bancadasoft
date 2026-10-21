// Cria o pacote "Outro valor" da "Recarga de Saldo": um ProviderProduct do
// provider interno "internal-balance" com metadata.freeAmount = true (sem
// creditAmountCents) e a ProductVariant "Outro valor" no Product
// "recarga-de-saldo". O valor é digitado pelo cliente no checkout (R$ 15,00 a
// R$ 5.000,00, validado no cliente e no servidor) e é o mesmo cobrado e
// creditado.
//
// Idempotente: se o pacote já existe com os dados esperados, não escreve
// nada; se existe com dados diferentes, aborta sem alterar. NÃO toca nos
// pacotes fixos (topup-1000/3000/5000), em nenhum outro Product/Provider, no
// schema nem no fulfillment-engine. Nenhum commit/push é feito por este script.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env scripts/seed-topup-free-amount.mjs
//   ESCRITA (somente com aprovação explícita; tudo numa única transação):
//     CONFIRM_TOPUP_FREE_AMOUNT=SIM node --env-file=.env scripts/seed-topup-free-amount.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const CONFIRM_ENV = "CONFIRM_TOPUP_FREE_AMOUNT";
export const PROVIDER_CODE = "internal-balance";
export const PRODUCT_SLUG = "recarga-de-saldo";
export const EXTERNAL_ID = "topup-free";
// Preço gravado = mínimo da recarga (só para o Admin e para a variante passar
// nas regras de publicação); o checkout cobra o valor digitado.
export const MIN_CENTS = 1500;

export function providerProductData(providerId) {
  return {
    providerId,
    productId: null, // vínculo é pela variante (mesmo modelo dos pacotes fixos)
    externalProductId: EXTERNAL_ID,
    label: "Recarga — outro valor",
    providerCostCents: null,
    currency: "BRL",
    active: true,
    mode: "REAL",
    metadata: { freeAmount: true },
    automationClass: "AUTO_FIELD_BASED",
    technicalEligibility: "READY",
    homologationStatus: "UNTESTED",
    expectedDeliveryType: "TEXT",
  };
}

export function variantData(productId, providerProductId, sortOrder) {
  return {
    productId,
    providerProductId,
    name: "Outro valor",
    code: "recarga-outro-valor",
    active: true,
    sortOrder,
    priceCents: MIN_CENTS,
    normalPriceCents: MIN_CENTS,
    premiumPriceCents: null,
    pricingMode: "MANUAL",
    manualPriceCents: MIN_CENTS,
    pricingStatus: "MANUAL",
    publicationBlocked: false,
  };
}

// state: { provider, product, providerProduct (com variants), maxSortOrder }.
// Devolve { problems, action: "CREATE" | "NOTHING" }.
export function plan(state) {
  const problems = [];
  if (!state.provider) problems.push(`Provider "${PROVIDER_CODE}" não encontrado`);
  else if (!state.provider.active) problems.push(`Provider "${PROVIDER_CODE}" inativo`);
  if (!state.product) problems.push(`Product "${PRODUCT_SLUG}" não encontrado`);
  else if (state.product.type !== "BALANCE_TOPUP") problems.push(`Product "${PRODUCT_SLUG}" não é BALANCE_TOPUP`);
  if (problems.length) return { problems, action: "NOTHING" };
  const existing = state.providerProduct;
  if (!existing) return { problems, action: "CREATE" };
  const metadata = existing.metadata ?? {};
  if (metadata.freeAmount !== true || "creditAmountCents" in metadata)
    problems.push(`ProviderProduct ${EXTERNAL_ID} já existe com metadata inesperado: ${JSON.stringify(existing.metadata)}`);
  const variant = existing.variants?.[0];
  if (!variant) problems.push(`ProviderProduct ${EXTERNAL_ID} já existe sem variante (corrigir manualmente)`);
  else if (variant.productId !== state.product.id) problems.push(`Variante de ${EXTERNAL_ID} está em outro Product`);
  return { problems, action: "NOTHING" };
}

export function revertSql() {
  return [
    `DELETE FROM "ProductVariant" WHERE code = 'recarga-outro-valor' AND "productId" = (SELECT id FROM "Product" WHERE slug = '${PRODUCT_SLUG}');`,
    `DELETE FROM "ProviderProduct" WHERE "externalProductId" = '${EXTERNAL_ID}' AND "providerId" = (SELECT id FROM "Provider" WHERE code = '${PROVIDER_CODE}');`,
    "-- Só é seguro enquanto não houver OrderItem/ProviderOrder/AccountLedgerEntry ligados ao pacote.",
  ].join("\n");
}

export function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

async function loadState(db) {
  const [provider, product] = await Promise.all([
    db.provider.findUnique({ where: { code: PROVIDER_CODE }, select: { id: true, active: true } }),
    db.product.findUnique({ where: { slug: PRODUCT_SLUG }, select: { id: true, type: true } }),
  ]);
  const providerProduct = provider
    ? await db.providerProduct.findUnique({
      where: { providerId_externalProductId: { providerId: provider.id, externalProductId: EXTERNAL_ID } },
      select: { id: true, metadata: true, variants: { select: { id: true, productId: true } } },
    })
    : null;
  const last = product
    ? await db.productVariant.findFirst({ where: { productId: product.id }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
    : null;
  return { provider, product, providerProduct, maxSortOrder: last?.sortOrder ?? 0 };
}

const line = (text = "") => console.log(text);

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    line(`MODE: ${mode}${mode === "DRY_RUN" ? " (somente SELECTs; nenhuma escrita)" : " (escreve; uma única transação)"}`);
    const state = await loadState(db);
    const result = plan(state);
    if (result.problems.length) {
      for (const problem of result.problems) line(`  [FALHOU] ${problem}`);
      line("\nABORTADO: nada foi alterado.");
      return;
    }
    if (result.action === "NOTHING") {
      line(`\n[OK] pacote ${EXTERNAL_ID} já existe com os dados esperados. Nada a fazer.`);
      return;
    }
    line("\n-- Plano --");
    line(`  ProviderProduct: ${JSON.stringify(providerProductData(state.provider.id))}`);
    line(`  ProductVariant: ${JSON.stringify(variantData(state.product.id, "<providerProduct.id>", state.maxSortOrder + 1))}`);
    line("\n-- SQL de reversão (para depois de um --apply) --");
    line(revertSql());
    if (mode !== "APPLY") {
      line(`\n[DRY-RUN] nada foi escrito. Próximo passo (só com aprovação): --apply com ${CONFIRM_ENV}=SIM.`);
      return;
    }
    await db.$transaction(async (tx) => {
      const fresh = await loadState(tx);
      const again = plan(fresh);
      if (again.problems.length || again.action !== "CREATE")
        throw new Error(`ABORTADO (revalidação): ${again.problems.join("; ") || "pacote já criado"}`);
      const pp = await tx.providerProduct.create({ data: providerProductData(fresh.provider.id) });
      await tx.productVariant.create({ data: variantData(fresh.product.id, pp.id, fresh.maxSortOrder + 1) });
    });
    line(`\n[OK] pacote ${EXTERNAL_ID} criado.`);
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
