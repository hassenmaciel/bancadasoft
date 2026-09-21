// Separação da ficha "unlocktool-licenca-ativacao" (variantes 3/6/12 meses) em
// 3 Products públicos, um por duração, com vínculo DIRETO ao ProviderProduct
// (ProviderProduct.productId), como o unlocktool-6h já faz.
//
// Os 3 Products nascem em DRAFT e available=false: publicar é um passo
// posterior, manual, pelo Admin. Este script NUNCA toca em Order, OrderItem,
// Payment, Fulfillment, ProviderOrder, na ficha antiga, no unlocktool-6h, nos
// ProviderProducts 2194/2067-2069/58, em fieldSchema, no sync nem no schema.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-unlocktool-license-split.mjs
//   ESCRITA (somente com aprovação explícita; 1 transação):
//     CONFIRM_UNLOCKTOOL_SPLIT=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-unlocktool-license-split.mjs --apply

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveProviderProduct } from "../src/lib/providers/selection.ts";

export const OLD_SLUG = "unlocktool-licenca-ativacao";
export const CONFIRM_ENV = "CONFIRM_UNLOCKTOOL_SPLIT";
const SEARCH_BASE = "unlocktool licença ativação renovação utool active renew";

// Preço em centavos. Espelha o padrão do unlocktool-6h: priceCents,
// normalPriceCents e manualPriceCents iguais (o checkout cobra
// normalPriceCents; manualPriceCents é o que o motor de precificação, em modo
// MANUAL, usa como preço efetivo e por isso precisa coincidir para o sync não
// reescrever priceCents).
const SPECS = [
  { months: 3, externalId: "4662", priceCents: 15500, sortOrder: 30 },
  { months: 6, externalId: "4661", priceCents: 21000, sortOrder: 20 },
  { months: 12, externalId: "4663", priceCents: 31000, sortOrder: 10 },
];
// sortOrder: o catálogo ordena por featured desc, sortOrder DESC (maior primeiro),
// nome asc (catalog-search.ts: findPublicCatalog e stableCatalogSort). 30/20/10
// mostram 3, 6 e 12 meses nessa ordem.

export const longDescriptionFor = (months) =>
  `Ativa ou renova a licença UnlockTool de ${months} meses na sua conta UnlockTool. Você informa o usuário e o e-mail da conta no checkout. Nenhum código é enviado: a licença é aplicada direto na conta informada, em 1 a 24 horas após o pagamento confirmado, e você recebe a confirmação por e-mail. Confira o usuário com atenção: a ativação não pode ser desfeita.`;

export const searchTermsFor = (months) => `${SEARCH_BASE} ${months} meses`;

// brandId/categoryId/downloadUrl/downloadLabel vêm da ficha antiga (iguais aos
// dela). downloadUrl/downloadLabel só entram quando a ficha os tem.
export function buildProductData({ months, priceCents, sortOrder }, { brandId, categoryId, downloadUrl, downloadLabel }) {
  return {
    slug: `unlocktool-licenca-${months}-meses`,
    name: `UnlockTool — Licença ${months} meses`,
    description: `UnlockTool ${months} months License · Active/Renew`,
    longDescription: longDescriptionFor(months),
    type: "LICENSE",
    deliveryType: "AUTOMATIC",
    deliveryEstimate: "1 a 24 horas",
    searchTerms: searchTermsFor(months),
    duration: `${months} meses (ativação/renovação)`,
    imageUrl: null,
    priceCents,
    priceVisibility: "PUBLIC",
    normalPriceCents: priceCents,
    premiumPriceCents: null,
    pricingMode: "MANUAL",
    manualPriceCents: priceCents,
    pricingStatus: "MANUAL",
    featured: false,
    sortOrder,
    status: "DRAFT",
    available: false,
    categoryId,
    brandId,
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(downloadLabel ? { downloadLabel } : {}),
  };
}

export const buildPlan = (ids) =>
  SPECS.map((spec) => ({ ...spec, data: buildProductData(spec, ids) }));

export const PLAN_SLUGS = SPECS.map((spec) => `unlocktool-licenca-${spec.months}-meses`);
export const PLAN_EXTERNAL_IDS = SPECS.map((spec) => spec.externalId);

// Modo padrão é DRY-RUN. Escrever exige --apply E a variável de confirmação.
export function resolveMode(argv, env) {
  const apply = argv.includes("--apply");
  if (!apply) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM")
    throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

export const visibleFieldKeys = (fieldSchema) =>
  Array.isArray(fieldSchema)
    ? fieldSchema
        .filter((field) => field.customerVisible && field.key !== "quantity")
        .map((field) => field.key)
    : [];

const REQUIRED_KEYS = ["email", "username"];

// Elegibilidade do ProviderProduct para receber o vínculo direto.
export function providerProductProblems(pp) {
  const problems = [];
  if (!pp) return ["ProviderProduct não encontrado"];
  if (pp.productId !== null) problems.push(`productId já preenchido (${pp.productId})`);
  if (!pp.active) problems.push("active=false");
  if (pp.mode !== "REAL") problems.push(`mode=${pp.mode}`);
  if (!pp.provider?.active) problems.push("provider inativo");
  if (pp.provider?.code !== "heartunlocks") problems.push(`provider=${pp.provider?.code}`);
  if (pp.technicalEligibility !== "READY") problems.push(`technicalEligibility=${pp.technicalEligibility}`);
  if (pp.automationClass !== "AUTO_FIELD_BASED") problems.push(`automationClass=${pp.automationClass}`);
  if (pp.expectedDeliveryType !== "LICENSE") problems.push(`expectedDeliveryType=${pp.expectedDeliveryType}`);
  const keys = visibleFieldKeys(pp.fieldSchema);
  if (keys.join(",") !== REQUIRED_KEYS.join(","))
    problems.push(`campos visíveis=[${keys.join(",")}] (esperado ${REQUIRED_KEYS.join(",")})`);
  return problems;
}

// Simula a resolução real do checkout para um Product novo com o vínculo direto.
export function simulateNewProductResolution(pp, newProductId, providerMode) {
  const candidate = { ...pp, productId: newProductId };
  const result = resolveProviderProduct([candidate], providerMode);
  return {
    status: result.status,
    selectedId: result.providerProduct?.id ?? null,
    eligibleCount: result.status === "SELECTED" ? 1 : result.status === "AMBIGUOUS" ? ">1" : 0,
  };
}

// SQL de reversão: só desfaz o que este script criou. Não toca em nenhuma
// tabela de pedido/pagamento/fulfillment; o DELETE só apaga Products DRAFT sem
// nenhum OrderItem.
export function revertSql() {
  const slugs = PLAN_SLUGS.map((slug) => `'${slug}'`).join(", ");
  const ids = PLAN_EXTERNAL_IDS.map((id) => `'${id}'`).join(", ");
  return [
    "-- 1) desvincular (obrigatório antes de apagar: FK ProviderProduct.productId é RESTRICT)",
    `UPDATE "ProviderProduct" SET "productId" = NULL`,
    `  WHERE "externalProductId" IN (${ids})`,
    `    AND "productId" IN (SELECT id FROM "Product" WHERE slug IN (${slugs}));`,
    "-- 2) apagar os 3 Products criados (somente DRAFT e sem nenhum item de pedido)",
    `DELETE FROM "Product" WHERE slug IN (${slugs}) AND status = 'DRAFT'`,
    `  AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = "Product".id);`,
    "-- Se algum Product já foi publicado ou vendido, NÃO apague: pause (status PAUSED, available=false) pelo Admin.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Varredura estática: nenhuma query pública lista Product fora de PUBLISHED.
// ---------------------------------------------------------------------------
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

export function scanPublicProductQueries(srcDir = SRC_DIR) {
  const isAdmin = (file) => /[\\/]admin[\\/]|[\\/]api[\\/]admin[\\/]|[\\/]admin-[^\\/]*$|pricing-(service|admin)/.test(file);
  const pattern = /prisma\.product\.(findMany|findFirst|findUnique|count|groupBy)|products:\s*\{\s*some/g;
  const rows = [];
  for (const file of walk(srcDir)) {
    if (isAdmin(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const window = text.slice(match.index, match.index + 700);
      const line = text.slice(0, match.index).split("\n").length;
      rows.push({
        file: path.relative(path.join(srcDir, ".."), file).replaceAll("\\", "/"),
        line,
        guarded: /PUBLISHED|publicProductWhere|whereFor\(/.test(window),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);
const yes = (ok) => (ok ? "OK" : "FALHOU");

async function loadContext(db) {
  const old = await db.product.findUnique({
    where: { slug: OLD_SLUG },
    include: {
      brand: { select: { id: true, name: true, active: true } },
      category: { select: { id: true, name: true, active: true } },
      variants: { select: { id: true, code: true, active: true, providerProductId: true } },
      providerProducts: { select: { id: true, externalProductId: true } },
    },
  });
  const [existingSlugs, providerProducts, settings] = await Promise.all([
    db.product.findMany({ where: { slug: { in: PLAN_SLUGS } }, select: { id: true, slug: true } }),
    db.providerProduct.findMany({
      where: { externalProductId: { in: PLAN_EXTERNAL_IDS }, provider: { code: "heartunlocks" } },
      include: {
        provider: { select: { id: true, code: true, active: true } },
        variants: { select: { id: true, code: true, productId: true } },
        _count: { select: { orders: true, purchasedItems: true } },
      },
    }),
    db.siteSettings.findUnique({ where: { id: "default" }, select: { providerMode: true } }),
  ]);
  return { old, existingSlugs, providerProducts, providerMode: settings?.providerMode ?? "TEST" };
}

async function dryRun(db) {
  const { old, existingSlugs, providerProducts, providerMode } = await loadContext(db);
  let failed = false;
  const check = (label, ok, detail = "") => {
    if (!ok) failed = true;
    line(`  [${yes(ok)}] ${label}${detail ? ` — ${detail}` : ""}`);
  };

  line("MODE: DRY-RUN (somente SELECTs; nenhuma escrita)");
  if (!old) throw new Error(`ficha antiga ${OLD_SLUG} não encontrada`);
  const ids = { brandId: old.brandId, categoryId: old.categoryId, downloadUrl: old.downloadUrl, downloadLabel: old.downloadLabel };
  const plan = buildPlan(ids);
  line(`ficha antiga: downloadUrl=${JSON.stringify(old.downloadUrl)} downloadLabel=${JSON.stringify(old.downloadLabel)} (copiados para os 3 quando existem)`);
  const ppByExternal = new Map(providerProducts.map((pp) => [pp.externalProductId, pp]));

  line("\n=== (1) PRODUCTS QUE SERIAM CRIADOS ===");
  for (const item of plan) {
    line(`\n# ${item.data.slug}  (ProviderProduct ${item.externalId})`);
    for (const [key, value] of Object.entries(item.data)) line(`  ${key}: ${JSON.stringify(value)}`);
  }
  line("\nCampos NÃO gravados (ficam no default do schema): costCents (nulo), suggestedPriceCents (nulo), pricingComputedAt (nulo); downloadLabel só se a ficha antiga tiver.");

  line("\n=== (2) PROVIDERPRODUCTS QUE SERIAM ATUALIZADOS ===");
  for (const item of plan) {
    const pp = ppByExternal.get(item.externalId);
    line(`\n# ${item.externalId} -> ${item.data.slug}`);
    if (!pp) { line("  não encontrado"); continue; }
    line(`  label: ${pp.label}`);
    line(`  productId: ${pp.productId} -> <id do Product novo>`);
    line(`  active=${pp.active} mode=${pp.mode} technicalEligibility=${pp.technicalEligibility} automationClass=${pp.automationClass} expectedDeliveryType=${pp.expectedDeliveryType}`);
    line(`  provider=${pp.provider.code} (ativo=${pp.provider.active}) custo=${pp.providerCostCents} ${pp.currency}`);
    line(`  variante vinculada: ${pp.variants.map((v) => `${v.code} (ficha antiga=${v.productId === old.id})`).join(", ") || "nenhuma"}`);
    line(`  ProviderOrders=${pp._count.orders} itens de pedido=${pp._count.purchasedItems}`);
  }

  line("\n=== (3) VERIFICAÇÕES ===");
  check("slugs livres", existingSlugs.length === 0, existingSlugs.map((s) => s.slug).join(", ") || PLAN_SLUGS.join(", "));
  check("brand existe e ativa", Boolean(old.brand?.active), `${old.brand?.name} (${old.brandId})`);
  check("category existe e ativa", Boolean(old.category?.active), `${old.category?.name} (${old.categoryId})`);
  for (const item of plan) {
    const pp = ppByExternal.get(item.externalId);
    const problems = providerProductProblems(pp);
    check(`${item.externalId}: productId nulo e elegível`, problems.length === 0, problems.join("; ") || `campos visíveis=[${visibleFieldKeys(pp.fieldSchema)}]`);
  }
  line(`  providerMode do site: ${providerMode}`);
  for (const item of plan) {
    const pp = ppByExternal.get(item.externalId);
    if (!pp) continue;
    const sim = simulateNewProductResolution(pp, `<novo:${item.data.slug}>`, providerMode);
    check(
      `resolveProviderProduct(${item.data.slug}) = SELECTED com 1 elegível (${item.externalId})`,
      sim.status === "SELECTED" && sim.selectedId === pp.id,
      `status=${sim.status} elegíveis=${sim.eligibleCount}`,
    );
  }

  line("\n=== (4) IMPACTO NA FICHA ANTIGA ===");
  const oldVariantIds = old.variants.map((v) => v.id);
  const [itemsByVariant, itemsByProduct] = await Promise.all([
    db.orderItem.count({ where: { productVariantId: { in: oldVariantIds } } }),
    db.orderItem.count({ where: { productId: old.id } }),
  ]);
  line(`  ficha antiga: status=${old.status} available=${old.available}, ${old.variants.length} variantes (${old.variants.map((v) => `${v.code}${v.active ? "" : "[inativa]"}`).join(", ")})`);
  line(`  ProviderProducts vinculados DIRETO à ficha antiga (productId): ${old.providerProducts.length} (${old.providerProducts.map((p) => p.externalProductId).join(", ") || "nenhum"})`);
  check("itens de pedido ligados às variantes antigas = 0", itemsByVariant === 0, `${itemsByVariant}`);
  check("itens de pedido ligados à ficha antiga (productId) = 0", itemsByProduct === 0, `${itemsByProduct}`);
  line("  Por código:");
  line("   - O vínculo novo é ProviderProduct.productId = <Product novo>. A ficha antiga não ganha nenhum vínculo direto,");
  line("     então product.providerProducts dela continua vazio e a resolução AMBIGUOUS não pode ocorrer nela.");
  line("   - commerce.ts createOrder: com variantes, resolveCheckoutVariant usa SOMENTE [variant.providerProduct]; o ramo");
  line("     resolveProviderProduct(product.providerProducts) só roda quando a ficha não tem variantes (ver a linha do providerResolution).");
  line("   - As variantes antigas mantêm providerProductId (@unique) intacto: nada é movido nem apagado.");
  line("   - O sync não escreve productId; recalculateVariants continua atingindo as variantes antigas como hoje.");
  line("  Queries públicas que tocam Product (varredura estática de src, fora de admin):");
  const scan = scanPublicProductQueries();
  for (const row of scan) line(`   ${row.guarded ? "[filtra PUBLISHED]" : "[SEM FILTRO — revisar]"} ${row.file}:${row.line}`);
  const unguarded = scan.filter((row) => !row.guarded);
  if (unguarded.length) {
    const texts = walk(SRC_DIR).map((f) => readFileSync(f, "utf8"));
    const uses = texts.reduce((n, t) => n + (t.match(/productsForAdmin|setProductAvailability/g)?.length ?? 0), 0);
    line(`   (sem filtro: ${unguarded.map((r) => `${r.file}:${r.line}`).join(", ")}; referências a productsForAdmin/setProductAvailability em src = ${uses}, sendo 2 as definições)`);
  }
  line("   sitemap/robots: nenhum arquivo em src/app (não há sitemap).");
  line("   Home, catálogo e busca usam whereFor/publicProductWhere (status PUBLISHED + available); produto/[slug] usa status PUBLISHED + available;");
  line("   createOrder usa publicProductWhere. DRAFT com available=false não aparece em nenhuma delas.");

  line("\n=== (5) COMO REVERTER ===");
  line("Antes de --apply nada existe para reverter (dry-run não escreve). Depois de --apply, execute no SQL editor:");
  line(revertSql());
  line("Nenhuma tabela de pedido é tocada. O --apply imprime os ids criados para conferência.");

  line(`\nRESULTADO: ${failed ? "HÁ VERIFICAÇÕES FALHAS — --apply seria recusado." : "todas as verificações OK — --apply seria aceito."}`);
  if (failed) process.exitCode = 2;
}

async function apply(db) {
  line("MODE: APPLY (1 transação)");
  const summary = await db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx);
      const { old, existingSlugs, providerProducts, providerMode } = ctx;
      // Pré-checagens
      if (existingSlugs.length)
        throw new Error(`ABORTADO: slug(s) já existe(m): ${existingSlugs.map((s) => s.slug).join(", ")}`);
      if (!old?.brand?.active || !old?.category?.active) throw new Error("ABORTADO: brand/category da ficha antiga indisponível");
      const plan = buildPlan({ brandId: old.brandId, categoryId: old.categoryId, downloadUrl: old.downloadUrl, downloadLabel: old.downloadLabel });
      const ppByExternal = new Map(providerProducts.map((pp) => [pp.externalProductId, pp]));
      for (const item of plan) {
        const problems = providerProductProblems(ppByExternal.get(item.externalId));
        if (problems.length) throw new Error(`ABORTADO: ${item.externalId}: ${problems.join("; ")}`);
      }
      const orderItemsBefore = await tx.orderItem.count();
      const oldBefore = { status: old.status, available: old.available, variants: old.variants.length };

      // Escrita
      const created = [];
      for (const item of plan) {
        const product = await tx.product.create({ data: item.data, select: { id: true, slug: true } });
        const pp = ppByExternal.get(item.externalId);
        const linked = await tx.providerProduct.updateMany({
          where: { id: pp.id, productId: null },
          data: { productId: product.id },
        });
        if (linked.count !== 1) throw new Error(`ABORTADO: vínculo ${item.externalId} não aplicado (concorrência?)`);
        created.push({ ...product, externalId: item.externalId, providerProductId: pp.id });
      }

      // Pós-checagens
      for (const row of created) {
        const product = await tx.product.findUniqueOrThrow({
          where: { id: row.id },
          include: { providerProducts: { include: { provider: { select: { id: true, code: true, active: true } } } } },
        });
        if (product.status !== "DRAFT" || product.available !== false || product.imageUrl !== null || product.featured !== false || product.downloadUrl !== (old.downloadUrl ?? null))
          throw new Error(`ABORTADO: pós-checagem de ${row.slug} (estado inesperado)`);
        const resolution = resolveProviderProduct(product.providerProducts, providerMode);
        if (resolution.status !== "SELECTED" || resolution.providerProduct.id !== row.providerProductId)
          throw new Error(`ABORTADO: resolveProviderProduct(${row.slug}) = ${resolution.status}`);
      }
      const oldAfter = await tx.product.findUniqueOrThrow({
        where: { id: old.id },
        select: { status: true, available: true, _count: { select: { variants: true, providerProducts: true } } },
      });
      if (oldAfter.status !== oldBefore.status || oldAfter.available !== oldBefore.available || oldAfter._count.variants !== oldBefore.variants || oldAfter._count.providerProducts !== 0)
        throw new Error("ABORTADO: a ficha antiga mudou");
      if ((await tx.orderItem.count()) !== orderItemsBefore) throw new Error("ABORTADO: contagem de OrderItem mudou");
      return created;
    },
    { timeout: 30_000 },
  );
  for (const row of summary) line(`CRIADO ${row.slug} id=${row.id} <- ProviderProduct ${row.externalId} (${row.providerProductId})`);
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
