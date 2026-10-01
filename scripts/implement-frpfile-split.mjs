// Separação das 2 fichas FRPFILE publicadas (com variantes) em 5 Products
// públicos, um por serviço, com vínculo DIRETO ao ProviderProduct
// (ProviderProduct.productId), no mesmo padrão do UnlockTool
// (scripts/implement-unlocktool-license-split.mjs):
//   frpfile-ramdisk-passcode-disabled -> #223, #4400, #4401
//   frpfile-activator-a12-plus        -> #3126, #3128
//
// Os 5 Products nascem em DRAFT e available=false: publicar e desligar as
// fichas antigas é um passo posterior, manual, pelo Admin.
//
// Diferente do UnlockTool, as fichas antigas TÊM pedidos reais (OrderItems
// DELIVERED em #4401 e #3126). Por isso a trava "zero OrderItems" foi trocada
// por um snapshot das variantes antigas (id, active, providerProductId,
// OrderItems e ProviderOrders por variante) + totais globais, comparado antes
// e depois dentro da mesma transação. Este script NUNCA escreve em Order,
// OrderItem, Payment, Fulfillment, ProviderOrder, ProductVariant nem nas
// fichas antigas; só cria Products e preenche ProviderProduct.productId.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-frpfile-split.mjs
//   ESCRITA (somente com aprovação explícita; 1 transação):
//     CONFIRM_FRPFILE_SPLIT=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-frpfile-split.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveProviderProduct } from "../src/lib/providers/selection.ts";

export const CONFIRM_ENV = "CONFIRM_FRPFILE_SPLIT";
export const OLD_SLUGS = ["frpfile-ramdisk-passcode-disabled", "frpfile-activator-a12-plus"];

// Preço: copiado da variante de origem (priceCents/premiumPriceCents),
// normalPriceCents = manualPriceCents = priceCents, pricingMode MANUAL — como
// no UnlockTool, para o sync não reescrever priceCents. O cliente paga hoje o
// mesmo valor que paga escolhendo a variante.
// sortOrder: catálogo ordena DESC; fica na mesma faixa das fichas antigas
// (130 e 120) e mantém a ordem das variantes.
export const SPECS = [
  {
    oldSlug: "frpfile-ramdisk-passcode-disabled",
    variantCode: "ios-11-16-sem-jailbreak",
    externalId: "223",
    slug: "frpfile-ramdisk-passcode-ios-11-16",
    name: "FRPFILE Ramdisk — Passcode/Disabled iOS 11 a 16",
    description: "Bypass de Passcode/Disabled por ECID, iOS 11 a 16, sem jailbreak",
    fieldLabel: "ECID",
    extraSearch: "ios 11 12 13 14 15 16 sem jailbreak",
    expectedDeliveryType: "CODE",
    fieldKeys: ["ecid"],
    sortOrder: 133,
  },
  {
    oldSlug: "frpfile-ramdisk-passcode-disabled",
    variantCode: "a12-com-sinal",
    externalId: "4400",
    slug: "frpfile-ramdisk-a12-com-sinal",
    name: "FRPFILE Ramdisk A12 — Passcode com sinal",
    description: "Bypass de Passcode em A12 com sinal, com leitura de Owner Info e informações de hardware",
    fieldLabel: "ECID",
    extraSearch: "a12 com sinal owner info",
    expectedDeliveryType: "CODE",
    fieldKeys: ["ecid"],
    sortOrder: 132,
  },
  {
    oldSlug: "frpfile-ramdisk-passcode-disabled",
    variantCode: "a13-com-sinal",
    externalId: "4401",
    slug: "frpfile-ramdisk-a13-com-sinal",
    name: "FRPFILE Ramdisk A13 — Passcode com sinal",
    description: "Bypass de Passcode em A13 com sinal, com leitura de Owner Info e informações de hardware",
    fieldLabel: "ECID",
    extraSearch: "a13 com sinal owner info",
    expectedDeliveryType: "CODE",
    fieldKeys: ["ecid"],
    sortOrder: 131,
  },
  {
    oldSlug: "frpfile-activator-a12-plus",
    variantCode: "a12-plus-com-icloud",
    externalId: "3126",
    slug: "frpfile-activator-a12-plus-com-icloud",
    name: "FRPFILE Activator A12+ — com serviços iCloud",
    description: "Bypass Hello Screen com serviços iCloud e notificações. iPhone 11 a 16 Pro Max e iPad A12+ a M3, iOS 26.0 a 26.1",
    fieldLabel: "número de série",
    extraSearch: "com icloud ios 26",
    expectedDeliveryType: "TEXT",
    fieldKeys: ["serial"],
    sortOrder: 122,
  },
  {
    oldSlug: "frpfile-activator-a12-plus",
    variantCode: "a12-plus-sem-icloud",
    externalId: "3128",
    slug: "frpfile-activator-a12-plus-sem-icloud",
    name: "FRPFILE Activator A12+ — sem serviços iCloud",
    description: "Bypass Hello Screen com notificações, sem serviços iCloud. iPhone XR a 17 Pro Max e iPad A12+ a M3",
    fieldLabel: "número de série",
    extraSearch: "sem icloud",
    expectedDeliveryType: "TEXT",
    fieldKeys: ["serial"],
    sortOrder: 121,
  },
];

export const PLAN_SLUGS = SPECS.map((spec) => spec.slug);
export const PLAN_EXTERNAL_IDS = SPECS.map((spec) => spec.externalId);

export const longDescriptionFor = (spec) =>
  `${spec.description}. Você informa o ${spec.fieldLabel} do aparelho no checkout e o serviço é processado automaticamente após o pagamento confirmado. Confira o ${spec.fieldLabel} com atenção antes de pagar.`;

// old: ficha antiga (categoryId, brandId, type, deliveryType, deliveryEstimate,
// priceVisibility, imageUrl, searchTerms); variant: variante de origem.
export function buildProductData(spec, old, variant) {
  const priceCents = variant.priceCents;
  return {
    slug: spec.slug,
    name: spec.name,
    description: spec.description,
    longDescription: longDescriptionFor(spec),
    type: old.type,
    deliveryType: old.deliveryType,
    deliveryEstimate: old.deliveryEstimate,
    searchTerms: `${old.searchTerms} ${spec.extraSearch}`.trim(),
    duration: null,
    imageUrl: old.imageUrl ?? null,
    priceCents,
    priceVisibility: old.priceVisibility,
    normalPriceCents: priceCents,
    premiumPriceCents: variant.premiumPriceCents ?? null,
    pricingMode: "MANUAL",
    manualPriceCents: priceCents,
    pricingStatus: "MANUAL",
    featured: false,
    sortOrder: spec.sortOrder,
    status: "DRAFT",
    available: false,
    categoryId: old.categoryId,
    brandId: old.brandId,
  };
}

export function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

export const visibleFieldKeys = (fieldSchema) =>
  Array.isArray(fieldSchema)
    ? fieldSchema.filter((field) => field.customerVisible && field.key !== "quantity").map((field) => field.key)
    : [];

export function providerProductProblems(pp, spec) {
  const problems = [];
  if (!pp) return ["ProviderProduct não encontrado"];
  if (pp.productId !== null) problems.push(`productId já preenchido (${pp.productId})`);
  if (!pp.active) problems.push("active=false");
  if (pp.mode !== "REAL") problems.push(`mode=${pp.mode}`);
  if (!pp.provider?.active) problems.push("provider inativo");
  if (pp.provider?.code !== "heartunlocks") problems.push(`provider=${pp.provider?.code}`);
  if (pp.technicalEligibility !== "READY") problems.push(`technicalEligibility=${pp.technicalEligibility}`);
  if (pp.automationClass !== "AUTO_FIELD_BASED") problems.push(`automationClass=${pp.automationClass}`);
  if (pp.expectedDeliveryType !== spec.expectedDeliveryType)
    problems.push(`expectedDeliveryType=${pp.expectedDeliveryType} (esperado ${spec.expectedDeliveryType})`);
  const keys = visibleFieldKeys(pp.fieldSchema);
  if (keys.join(",") !== spec.fieldKeys.join(","))
    problems.push(`campos visíveis=[${keys.join(",")}] (esperado ${spec.fieldKeys.join(",")})`);
  return problems;
}

// A variante de origem precisa existir na ficha antiga, ativa, com preço,
// apontando para o ProviderProduct da especificação.
export function sourceVariantProblems(old, spec, pp) {
  if (!old) return [`ficha ${spec.oldSlug} não encontrada`];
  const variant = old.variants.find((v) => v.code === spec.variantCode);
  if (!variant) return [`variante ${spec.variantCode} não encontrada`];
  const problems = [];
  if (!variant.active) problems.push("variante inativa");
  if (!(variant.priceCents > 0)) problems.push(`priceCents=${variant.priceCents}`);
  if (pp && variant.providerProductId !== pp.id) problems.push("variante aponta para outro ProviderProduct");
  return problems;
}

export function simulateNewProductResolution(pp, newProductId, providerMode) {
  const result = resolveProviderProduct([{ ...pp, productId: newProductId }], providerMode);
  return { status: result.status, selectedId: result.providerProduct?.id ?? null };
}

// Estado que NÃO pode mudar: fichas antigas, cada variante antiga e os
// pedidos ligados a elas, mais os totais globais de OrderItem/ProviderOrder.
export async function orderSnapshot(db, olds) {
  const variants = [];
  for (const old of olds) {
    for (const v of old.variants) {
      const [orderItems, providerOrders] = await Promise.all([
        db.orderItem.count({ where: { productVariantId: v.id } }),
        db.providerOrder.count({ where: { providerProductId: v.providerProductId } }),
      ]);
      variants.push({ product: old.slug, id: v.id, code: v.code, active: v.active, providerProductId: v.providerProductId, orderItems, providerOrders });
    }
  }
  const products = olds.map((o) => ({ slug: o.slug, status: o.status, available: o.available, variants: o.variants.length, orderItems: o._count.orderItems }));
  const [orderItemsTotal, providerOrdersTotal] = await Promise.all([db.orderItem.count(), db.providerOrder.count()]);
  return { products, variants, orderItemsTotal, providerOrdersTotal };
}

export function snapshotDiff(before, after) {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  return a === b ? null : { before, after };
}

export function revertSql() {
  const slugs = PLAN_SLUGS.map((slug) => `'${slug}'`).join(", ");
  const ids = PLAN_EXTERNAL_IDS.map((id) => `'${id}'`).join(", ");
  return [
    "-- 1) desvincular (obrigatório antes de apagar: FK ProviderProduct.productId é RESTRICT)",
    `UPDATE "ProviderProduct" SET "productId" = NULL`,
    `  WHERE "externalProductId" IN (${ids})`,
    `    AND "productId" IN (SELECT id FROM "Product" WHERE slug IN (${slugs}));`,
    "-- 2) apagar os 5 Products criados (somente DRAFT e sem nenhum item de pedido)",
    `DELETE FROM "Product" WHERE slug IN (${slugs}) AND status = 'DRAFT'`,
    `  AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = "Product".id);`,
    "-- Se algum Product já foi publicado ou vendido, NÃO apague: pause (status PAUSED, available=false) pelo Admin.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);
const yes = (ok) => (ok ? "OK" : "FALHOU");

async function loadContext(db) {
  const [olds, existingSlugs, providerProducts, settings] = await Promise.all([
    db.product.findMany({
      where: { slug: { in: OLD_SLUGS } },
      orderBy: { slug: "asc" },
      include: {
        brand: { select: { name: true, active: true } },
        category: { select: { name: true, active: true } },
        variants: { orderBy: { id: "asc" } },
        providerProducts: { select: { id: true } },
        _count: { select: { orderItems: true } },
      },
    }),
    db.product.findMany({ where: { slug: { in: PLAN_SLUGS } }, select: { slug: true } }),
    db.providerProduct.findMany({
      where: { externalProductId: { in: PLAN_EXTERNAL_IDS }, provider: { code: "heartunlocks" } },
      include: { provider: { select: { id: true, code: true, active: true } } },
    }),
    db.siteSettings.findUnique({ where: { id: "default" }, select: { providerMode: true } }),
  ]);
  const oldBySlug = new Map(olds.map((o) => [o.slug, o]));
  const ppByExternal = new Map(providerProducts.map((pp) => [pp.externalProductId, pp]));
  const plan = SPECS.map((spec) => {
    const old = oldBySlug.get(spec.oldSlug);
    const pp = ppByExternal.get(spec.externalId);
    const variant = old?.variants.find((v) => v.code === spec.variantCode);
    const problems = [...sourceVariantProblems(old, spec, pp), ...providerProductProblems(pp, spec)];
    return { spec, old, pp, variant, problems, data: old && variant ? buildProductData(spec, old, variant) : null };
  });
  return { olds, existingSlugs, plan, providerMode: settings?.providerMode ?? "TEST" };
}

function preconditionProblems({ olds, existingSlugs, plan, providerMode }) {
  const problems = [];
  if (olds.length !== OLD_SLUGS.length) problems.push("ficha antiga ausente");
  if (existingSlugs.length) problems.push(`slug(s) já existe(m): ${existingSlugs.map((s) => s.slug).join(", ")}`);
  for (const old of olds) {
    if (!old.brand?.active || !old.category?.active) problems.push(`${old.slug}: brand/category inativa`);
    if (old.providerProducts.length) problems.push(`${old.slug}: já tem vínculo direto`);
  }
  for (const item of plan) {
    for (const p of item.problems) problems.push(`${item.spec.externalId}: ${p}`);
    if (item.pp && !item.problems.length) {
      const sim = simulateNewProductResolution(item.pp, `<novo:${item.spec.slug}>`, providerMode);
      if (sim.status !== "SELECTED" || sim.selectedId !== item.pp.id)
        problems.push(`${item.spec.externalId}: resolveProviderProduct=${sim.status}`);
    }
  }
  return problems;
}

async function dryRun(db) {
  const ctx = await loadContext(db);
  line("MODE: DRY-RUN (somente SELECTs; nenhuma escrita)");
  line(`providerMode do site: ${ctx.providerMode}`);

  line("\n=== (1) PRODUCTS QUE SERIAM CRIADOS ===");
  for (const item of ctx.plan) {
    line(`\n# ${item.spec.slug}  <- ${item.spec.oldSlug} [${item.spec.variantCode}]  ProviderProduct heartunlocks#${item.spec.externalId}`);
    if (!item.data) { line("  (sem dados: ficha/variante ausente)"); continue; }
    for (const [key, value] of Object.entries(item.data)) line(`  ${key}: ${JSON.stringify(value)}`);
  }

  line("\n=== (2) VÍNCULOS (ProviderProduct.productId) ===");
  for (const item of ctx.plan) {
    const pp = item.pp;
    if (!pp) { line(`  #${item.spec.externalId}: não encontrado`); continue; }
    line(`  #${pp.externalProductId} (${pp.id}) productId: ${pp.productId} -> <id de ${item.spec.slug}>`);
    line(`     nome do fornecedor (só admin): "${pp.label}"`);
    line(`     campos visíveis=[${visibleFieldKeys(pp.fieldSchema)}] entrega=${pp.expectedDeliveryType} custo=${pp.providerCostCents} ${pp.currency}`);
    line(`     continua também como variante ${item.spec.variantCode} da ficha antiga (providerProductId intacto)`);
  }

  line("\n=== (3) VERIFICAÇÕES ===");
  const problems = preconditionProblems(ctx);
  line(`  [${yes(!ctx.existingSlugs.length)}] slugs livres: ${PLAN_SLUGS.join(", ")}`);
  for (const old of ctx.olds) line(`  [${yes(old.brand?.active && old.category?.active)}] ${old.slug}: brand ${old.brand?.name} / category ${old.category?.name}`);
  for (const item of ctx.plan) {
    line(`  [${yes(!item.problems.length)}] #${item.spec.externalId} elegível e variante de origem ok${item.problems.length ? ` — ${item.problems.join("; ")}` : ""}`);
    if (item.pp && !item.problems.length) {
      const sim = simulateNewProductResolution(item.pp, "<novo>", ctx.providerMode);
      line(`  [${yes(sim.status === "SELECTED")}] resolveProviderProduct(${item.spec.slug}) = ${sim.status}`);
    }
  }

  line("\n=== (4) PEDIDOS NAS FICHAS ANTIGAS (snapshot que o --apply exige inalterado) ===");
  const snap = await orderSnapshot(db, ctx.olds);
  for (const p of snap.products) line(`  ${p.slug}: status=${p.status} available=${p.available} variantes=${p.variants} OrderItems=${p.orderItems}`);
  for (const v of snap.variants) line(`   - ${v.product} [${v.code}] active=${v.active} OrderItems=${v.orderItems} ProviderOrders(do PP)=${v.providerOrders}`);
  line(`  totais globais: OrderItem=${snap.orderItemsTotal} ProviderOrder=${snap.providerOrdersTotal}`);
  line("  O script não escreve em nenhuma dessas tabelas nem nas variantes/fichas antigas.");

  line("\n=== (5) COMO REVERTER (após --apply) ===");
  line(revertSql());

  line(`\nRESULTADO: ${problems.length ? `HÁ VERIFICAÇÕES FALHAS — --apply seria recusado:\n  ${problems.join("\n  ")}` : "todas as verificações OK — --apply seria aceito."}`);
  if (problems.length) process.exitCode = 2;
}

async function apply(db) {
  line("MODE: APPLY (1 transação)");
  const created = await db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx);
      const problems = preconditionProblems(ctx);
      if (problems.length) throw new Error(`ABORTADO: ${problems.join("; ")}`);
      const before = await orderSnapshot(tx, ctx.olds);

      const rows = [];
      for (const item of ctx.plan) {
        const product = await tx.product.create({ data: item.data, select: { id: true, slug: true } });
        const linked = await tx.providerProduct.updateMany({ where: { id: item.pp.id, productId: null }, data: { productId: product.id } });
        if (linked.count !== 1) throw new Error(`ABORTADO: vínculo #${item.spec.externalId} não aplicado (concorrência?)`);
        rows.push({ ...product, externalId: item.spec.externalId, providerProductId: item.pp.id });
      }

      for (const row of rows) {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: row.id },
          include: { providerProducts: { include: { provider: { select: { id: true, code: true, active: true } } } } },
        });
        if (product.status !== "DRAFT" || product.available !== false)
          throw new Error(`ABORTADO: pós-checagem de ${row.slug} (estado inesperado)`);
        const resolution = resolveProviderProduct(product.providerProducts, ctx.providerMode);
        if (resolution.status !== "SELECTED" || resolution.providerProduct.id !== row.providerProductId)
          throw new Error(`ABORTADO: resolveProviderProduct(${row.slug}) = ${resolution.status}`);
      }
      const after = await orderSnapshot(tx, (await loadContext(tx)).olds);
      const diff = snapshotDiff(before, after);
      if (diff) throw new Error(`ABORTADO: fichas/variantes/pedidos antigos mudaram: ${JSON.stringify(diff)}`);
      return rows;
    },
    { timeout: 30_000 },
  );
  for (const row of created) line(`CRIADO ${row.slug} id=${row.id} <- ProviderProduct #${row.externalId} (${row.providerProductId})`);
  line("\nPara reverter:");
  line(revertSql());
}

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    if (mode === "APPLY") await apply(db);
    else await dryRun(db);
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
