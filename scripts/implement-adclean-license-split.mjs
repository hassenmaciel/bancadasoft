// Refaz o catálogo da Licença AdClean: a ficha única "adclean-licenca" (3
// ProductVariant 12h / 6 meses / 1 ano) vira 3 Products, um por período, cada
// um com vínculo DIRETO ao seu ProviderProduct (ProviderProduct.productId),
// como o UnlockTool. Motivo: resellerPriceCents fica no Product, então com
// variantes as 3 durações teriam o mesmo preço de revenda.
//
// Os 3 Products nascem como a ficha antiga: DRAFT, available=false, sem preço
// de venda (manualPriceCents null) e sem resellerPriceCents — definidos depois
// no Admin. Só apaga a ficha antiga e suas variantes se NADA as referencia
// (OrderItem por produto, variante ou ProviderProduct; ProviderOrder). NÃO toca
// no Provider, nos ProviderProducts (exceto productId), em pedidos, no
// schema nem no sync. Nenhum commit/push é feito por este script.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-adclean-license-split.mjs
//   ESCRITA (somente com aprovação explícita; tudo numa única transação):
//     CONFIRM_ADCLEAN_LICENSE_SPLIT=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-adclean-license-split.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveProviderProduct } from "../src/lib/providers/selection.ts";
import { CATEGORY_SLUG, PERIODS, PRODUCT as OLD_PRODUCT, PROVIDER } from "./implement-adclean-license.mjs";

export const CONFIRM_ENV = "CONFIRM_ADCLEAN_LICENSE_SPLIT";
export const OLD_SLUG = OLD_PRODUCT.slug;
export const PROVIDER_CODE = PROVIDER.code;

// sortOrder: o catálogo ordena por sortOrder DESC, então 30/20/10 mostra
// 12h, 6 meses e 1 ano nessa ordem (mesmo esquema do UnlockTool).
const SORT_ORDER = { "12h": 30, "6-meses": 20, "1-ano": 10 };

export const slugFor = (period) => `${OLD_SLUG}-${period.code}`;

export function buildProductData(period, categoryId) {
  return {
    slug: slugFor(period),
    name: `AdClean — Licença ${period.name}`,
    description: `Licença do Repair AdClean por ${period.name}.`,
    longDescription: OLD_PRODUCT.longDescription,
    type: OLD_PRODUCT.type,
    deliveryType: OLD_PRODUCT.deliveryType,
    deliveryEstimate: OLD_PRODUCT.deliveryEstimate,
    searchTerms: `${OLD_PRODUCT.searchTerms} ${period.name}`,
    duration: period.name,
    priceCents: 0,
    priceVisibility: OLD_PRODUCT.priceVisibility,
    pricingMode: "MANUAL",
    pricingStatus: "NEEDS_REVIEW",
    manualPriceCents: null,
    resellerPriceCents: null,
    status: "DRAFT",
    available: false,
    featured: false,
    sortOrder: SORT_ORDER[period.code],
    categoryId,
  };
}

export const PLAN = PERIODS.map((period) => ({ period, slug: slugFor(period), externalId: period.externalId }));
export const PLAN_SLUGS = PLAN.map((item) => item.slug);

export function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

// Pré-condições puras (testáveis sem banco).
export function preconditionProblems(state) {
  const problems = [];
  const { old, providerProducts, existingSlugs, category, references } = state;
  if (!old) problems.push(`Product "${OLD_SLUG}" não encontrado`);
  else {
    if (old.status !== "DRAFT") problems.push(`"${OLD_SLUG}" status=${old.status} (esperado DRAFT)`);
    if (old.available !== false) problems.push(`"${OLD_SLUG}" available=${old.available} (esperado false)`);
    const codes = old.variants.map((v) => v.code).sort().join(",");
    const expected = PERIODS.map((p) => p.code).sort().join(",");
    if (codes !== expected) problems.push(`variantes de "${OLD_SLUG}" = [${codes}] (esperado ${expected})`);
    if (old.providerProductsCount !== 0) problems.push(`"${OLD_SLUG}" tem ${old.providerProductsCount} vínculo(s) direto(s)`);
  }
  for (const item of PLAN) {
    const pp = providerProducts.find((row) => row.externalProductId === item.externalId);
    if (!pp) {
      problems.push(`ProviderProduct ${item.externalId} não encontrado`);
      continue;
    }
    if (pp.productId !== null) problems.push(`ProviderProduct ${item.externalId} já tem productId (${pp.productId})`);
    const variant = old?.variants.find((v) => v.providerProductId === pp.id);
    if (old && variant?.code !== item.period.code)
      problems.push(`ProviderProduct ${item.externalId} não está na variante ${item.period.code} da ficha antiga`);
  }
  for (const row of existingSlugs) problems.push(`slug "${row.slug}" já existe (id ${row.id})`);
  if (!category) problems.push(`categoria "${CATEGORY_SLUG}" não encontrada`);
  else if (!category.active) problems.push(`categoria "${CATEGORY_SLUG}" inativa`);
  for (const [label, count] of Object.entries(references ?? {}))
    if (count !== 0) problems.push(`${label} = ${count} (esperado 0)`);
  return problems;
}

export function revertSql() {
  const slugs = PLAN_SLUGS.map((slug) => `'${slug}'`).join(", ");
  const ids = PLAN.map((item) => `'${item.externalId}'`).join(", ");
  return [
    "-- 1) desvincular (FK ProviderProduct.productId é RESTRICT)",
    `UPDATE "ProviderProduct" SET "productId" = NULL WHERE "externalProductId" IN (${ids})`,
    `  AND "providerId" = (SELECT id FROM "Provider" WHERE code = '${PROVIDER_CODE}');`,
    "-- 2) apagar os 3 Products (somente DRAFT e sem nenhum item de pedido)",
    `DELETE FROM "Product" WHERE slug IN (${slugs}) AND status = 'DRAFT'`,
    `  AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = "Product".id);`,
    "-- A ficha antiga com variantes não é recriada: esse formato não serve para a revenda.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);

async function loadState(db) {
  const [oldRow, providerProducts, existingSlugs, category, settings] = await Promise.all([
    db.product.findUnique({
      where: { slug: OLD_SLUG },
      select: {
        id: true,
        status: true,
        available: true,
        variants: { select: { id: true, code: true, providerProductId: true } },
        _count: { select: { providerProducts: true, orderItems: true } },
      },
    }),
    db.providerProduct.findMany({
      where: { externalProductId: { in: PLAN.map((item) => item.externalId) }, provider: { code: PROVIDER_CODE } },
      select: {
        id: true,
        externalProductId: true,
        productId: true,
        active: true,
        mode: true,
        technicalEligibility: true,
        providerCostCents: true,
        provider: { select: { id: true, code: true, active: true } },
        _count: { select: { orders: true, purchasedItems: true } },
      },
    }),
    db.product.findMany({ where: { slug: { in: PLAN_SLUGS } }, select: { id: true, slug: true } }),
    db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, active: true } }),
    db.siteSettings.findUnique({ where: { id: "default" }, select: { providerMode: true } }),
  ]);
  const old = oldRow && { ...oldRow, providerProductsCount: oldRow._count.providerProducts };
  const variantIds = old?.variants.map((v) => v.id) ?? [];
  const references = {
    "OrderItem da ficha antiga (productId)": old?._count.orderItems ?? 0,
    "OrderItem das variantes antigas": variantIds.length
      ? await db.orderItem.count({ where: { productVariantId: { in: variantIds } } })
      : 0,
    "OrderItem dos ProviderProducts da licença": providerProducts.reduce((n, pp) => n + pp._count.purchasedItems, 0),
    "ProviderOrder dos ProviderProducts da licença": providerProducts.reduce((n, pp) => n + pp._count.orders, 0),
  };
  return { old, providerProducts, existingSlugs, category, references, providerMode: settings?.providerMode ?? "TEST" };
}

// Com o Provider ainda inativo o checkout resolve MISSING (esperado); aqui se
// confere que, quando ele for ativado, cada Product resolve exatamente 1.
function resolutionWhenProviderActive(pp, productId, providerMode) {
  const candidate = { ...pp, productId, provider: { ...pp.provider, active: true } };
  return resolveProviderProduct([candidate], providerMode);
}

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    line(`MODE: ${mode}${mode === "DRY_RUN" ? " (somente SELECTs; nenhuma escrita)" : " (escreve; uma única transação)"}`);
    const state = await loadState(db);
    const problems = preconditionProblems(state);

    line("\n-- Estado atual --");
    line(`  ficha antiga ${OLD_SLUG}: ${state.old ? `id=${state.old.id} status=${state.old.status} available=${state.old.available}` : "não encontrada"}`);
    for (const variant of state.old?.variants ?? []) {
      const pp = state.providerProducts.find((row) => row.id === variant.providerProductId);
      line(`    variante ${variant.code} (id ${variant.id}) -> ProviderProduct ${pp?.externalProductId ?? variant.providerProductId}`);
    }
    for (const [label, count] of Object.entries(state.references)) line(`  ${label}: ${count}`);
    line(`  providerMode do site: ${state.providerMode}`);

    line("\n-- Pré-condições --");
    if (problems.length) {
      for (const problem of problems) line(`  [FALHOU] ${problem}`);
      line("\nABORTADO: nada foi alterado.");
      process.exitCode = 2;
      return;
    }
    line("  [OK] todas");

    line("\n-- Plano --");
    line(`  APAGAR ${state.old.variants.length} ProductVariant de ${OLD_SLUG}: ${state.old.variants.map((v) => v.code).join(", ")}`);
    line(`  APAGAR Product ${OLD_SLUG} (id ${state.old.id})`);
    for (const item of PLAN) {
      const pp = state.providerProducts.find((row) => row.externalProductId === item.externalId);
      line(`  CRIAR Product ${JSON.stringify(buildProductData(item.period, `<${CATEGORY_SLUG}.id>`))}`);
      line(`  VINCULAR ProviderProduct ${item.externalId} (id ${pp.id}): productId null -> <id de ${item.slug}>`);
      const sim = resolutionWhenProviderActive(pp, `<${item.slug}>`, state.providerMode);
      line(`    checkout com o Provider ativo: resolveProviderProduct = ${sim.status}${sim.status === "SELECTED" ? " (1 elegível)" : ""}`);
    }

    if (mode !== "APPLY") {
      line(`\n[DRY-RUN] nada foi escrito. Próximo passo (só com aprovação): --apply com ${CONFIRM_ENV}=SIM.`);
      line("\n-- SQL de reversão (para depois de um --apply) --");
      line(revertSql());
      return;
    }

    const created = await db.$transaction(
      async (tx) => {
        const fresh = await loadState(tx);
        const freshProblems = preconditionProblems(fresh);
        if (freshProblems.length) throw new Error(`ABORTADO (revalidação): ${freshProblems.join("; ")}`);
        const orderItemsBefore = await tx.orderItem.count();

        await tx.productVariant.deleteMany({ where: { productId: fresh.old.id } });
        await tx.product.delete({ where: { id: fresh.old.id } });
        const rows = [];
        for (const item of PLAN) {
          const pp = fresh.providerProducts.find((row) => row.externalProductId === item.externalId);
          const product = await tx.product.create({
            data: buildProductData(item.period, fresh.category.id),
            select: { id: true, slug: true },
          });
          const linked = await tx.providerProduct.updateMany({
            where: { id: pp.id, productId: null },
            data: { productId: product.id },
          });
          if (linked.count !== 1) throw new Error(`ABORTADO: vínculo ${item.externalId} não aplicado`);
          rows.push({ ...product, externalId: item.externalId, providerProductId: pp.id });
        }

        // Pós-checagens
        if (await tx.product.findUnique({ where: { slug: OLD_SLUG }, select: { id: true } }))
          throw new Error("ABORTADO: ficha antiga ainda existe");
        for (const row of rows) {
          const product = await tx.product.findUniqueOrThrow({
            where: { id: row.id },
            select: {
              status: true,
              available: true,
              manualPriceCents: true,
              resellerPriceCents: true,
              _count: { select: { variants: true } },
              providerProducts: { select: { id: true } },
            },
          });
          if (
            product.status !== "DRAFT" ||
            product.available !== false ||
            product.manualPriceCents !== null ||
            product.resellerPriceCents !== null ||
            product._count.variants !== 0 ||
            product.providerProducts.length !== 1 ||
            product.providerProducts[0].id !== row.providerProductId
          )
            throw new Error(`ABORTADO: pós-checagem de ${row.slug} (estado inesperado)`);
        }
        if ((await tx.orderItem.count()) !== orderItemsBefore) throw new Error("ABORTADO: contagem de OrderItem mudou");
        return rows;
      },
      { timeout: 30_000 },
    );
    line("");
    for (const row of created) line(`[OK] CRIADO ${row.slug} id=${row.id} <- ProviderProduct ${row.externalId} (${row.providerProductId})`);
    line(`[OK] APAGADO ${OLD_SLUG} e suas variantes`);
    line("\nPara reverter:");
    line(revertSql());
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
