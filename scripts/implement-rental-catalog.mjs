// Implantação comercial do cluster "Rent's Digital Tools" HeartUnlocks
// (aluguel automático de login/senha, contractSignature 102cbb9ce75f...,
// AUTO_CREDENTIAL/READY, 35 ProviderProducts).
//
// Idempotente e escopado SOMENTE aos externalIds abaixo. Nunca toca em
// AMT/CF Tools/DFT Pro/TSM Tool/UnlockTool 6h (já publicados e
// PRODUCT_VALIDATED/CLASS_VALIDATED via essa mesma signature) nem em
// Order/Payment/ProviderOrder/Fulfillment/User.
//
// Uso:
//   node --env-file=.env --experimental-strip-types scripts/implement-rental-catalog.mjs
//     (DRY-RUN por padrão)
//   node --env-file=.env --experimental-strip-types scripts/implement-rental-catalog.mjs --execute

import { PrismaClient } from "@prisma/client";
import { calculatePricing } from "../src/lib/pricing.ts";

async function recalculateVariants(providerProductIds) {
  if (!providerProductIds.length) return 0;
  const variants = await prisma.productVariant.findMany({
    where: { providerProductId: { in: providerProductIds } },
    include: { providerProduct: true, product: { select: { type: true } } },
  });
  for (const variant of variants) {
    const result = calculatePricing({
      pricingMode: variant.pricingMode,
      manualPriceCents: variant.manualPriceCents,
      providerCostCents: variant.providerProduct.providerCostCents,
      providerCurrency: variant.providerProduct.currency,
      productType: variant.product.type,
      global: GLOBAL_RULE,
      group: null,
    });
    const data = {
      suggestedPriceCents: result.suggestedPriceCents,
      pricingStatus: result.pricingStatus,
      pricingComputedAt: new Date(),
      ...(variant.pricingMode === "MANUAL" && result.effectivePriceCents != null
        ? { priceCents: result.effectivePriceCents }
        : {}),
    };
    await prisma.productVariant.update({ where: { id: variant.id }, data });
  }
  return variants.length;
}

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes("--execute");
const PID = "cmtvkn9vo0005txksufxa22k3"; // Provider HeartUnlocks
const CATEGORY_ID = "cmtuuzwer0000tx5kl9b2k11w"; // Ferramentas (reused)

const GLOBAL_RULE = {
  automaticEnabled: false,
  exchangeRateMicros: 5_500_000,
  exchangeBufferBps: 500,
  targetMarginBps: 6000,
  minimumProfitCents: 500,
  asaasFeeType: "FIXED",
  asaasFixedFeeCents: 99,
  asaasPercentBps: 0,
  roundingMode: "X_90",
  minimumPriceCents: 1000,
};

function suggestedPriceFor(providerCostCents, currency, productType) {
  const result = calculatePricing({
    pricingMode: "AUTO_GLOBAL",
    providerCostCents,
    providerCurrency: currency,
    productType,
    global: GLOBAL_RULE,
    group: null,
  });
  return result.suggestedPriceCents;
}

// ---------------------------------------------------------------------------
// Já publicados via esta mesma contractSignature — NÃO TOCAR (nenhuma query
// é executada contra eles; listados aqui só para fechar a reconciliação dos
// 35 externalIds do cluster).
// ---------------------------------------------------------------------------
const ALREADY_PUBLISHED_UNTOUCHED = [
  { externalId: "2337", of: "AMT — Aluguel 2h (amt-aluguel)" },
  { externalId: "2212", of: "CF Tools — Aluguel 6h (cf-tools-aluguel-6h)" },
  { externalId: "2338", of: "DFT Pro — Aluguel 48h (dft-pro-aluguel)" },
  { externalId: "2334", of: "TSM Tool — Aluguel 3h (tsm-tool-aluguel-3h)" },
  { externalId: "2194", of: "UnlockTool 6h (unlocktool-6h), PRODUCT_VALIDATED" },
];

// ---------------------------------------------------------------------------
// ALTERNATIVE_SOURCE — mesma oferta comercial já coberta por um provider
// primário (publicado ou nesta própria implantação). Documentadas, não
// publicadas, sem fallback automático (exigiria arquitetura nova).
// ---------------------------------------------------------------------------
const ALTERNATIVE_SOURCES = [
  { externalId: "2216", of: "AMT — Aluguel 2h (já publicado, primary=2337)", reason: "mesma oferta (2h), custo diferente ($0,30 vs $0,35 do primary)" },
  { externalId: "2995", of: "AMT — Aluguel 2h (já publicado, primary=2337)", reason: "mesma oferta (2h), custo diferente ($0,40 vs $0,35 do primary)" },
  { externalId: "2211", of: "DFT Pro — Aluguel 48h (já publicado, primary=2338)", reason: "mesma oferta (48h), custo diferente ($1,70 vs $1,60 do primary)" },
  { externalId: "2210", of: "Griffin-Unlocker Tool — Não Premium 6h (primary=2996 nesta implantação)", reason: "mesma oferta (6h, mesmo custo $1,50), título/categoria diferente" },
  { externalId: "2336", of: "MDM FIX Tool — 6h (primary=2202 nesta implantação)", reason: "rotulado 'Souce 2' pelo próprio provider; mesma oferta (6h, mesmo custo $1,30)" },
  { externalId: "2998", of: "TSM Tool — Aluguel 3h (já publicado, primary=2334)", reason: "mesma oferta (3h, mesmo custo $0,28), não vinculada" },
  { externalId: "2333", of: "UnlockTool 6h (já publicado, primary=2194)", reason: "já documentado na Fase 4 (docs/PRIORITY_CATALOG_IMPLEMENTATION.md)" },
];

// ---------------------------------------------------------------------------
// BLOCKED — duração/tier divergente demais para presumir equivalência
// comercial sem confirmação humana (regra explícita: não decidir
// silenciosamente quando os dados divergem).
// ---------------------------------------------------------------------------
const BLOCKED = [
  { externalId: "2335", label: "TFM Tool Pro Rent [6 Hours] Souce 2", reason: "título indica tier 'Pro' e duração 6h, diferente do TFM Tool base (2200, 5h) — rotulado 'Souce 2' mas não claramente a mesma oferta; requer confirmação humana antes de publicar ou tratar como fonte alternativa" },
];

// ---------------------------------------------------------------------------
// Produtos simples (1 ProviderProduct, vínculo direto, sem variante).
// ---------------------------------------------------------------------------
const SIMPLE_PRODUCTS = [
  { slug: "anonyshu-tool-rent-10h", name: "AnonySHU Tool — Aluguel 10 Horas", brandName: "AnonySHU Tool", brandSlug: "anonyshu-tool", externalId: "2214", duration: "10 hours" },
  { slug: "arab-frp-tool-rent-3h", name: "Arab FRP Tool — Aluguel 3 Horas", brandName: "Arab FRP Tool", brandSlug: "arab-frp-tool", externalId: "2213", duration: "3 Hours" },
  { slug: "galaxy-multi-tool-rent-2h", name: "Galaxy Multi Tool — Aluguel 2 Horas", brandName: "Galaxy Multi Tool", brandSlug: "galaxy-multi-tool", externalId: "4349", duration: "2 Hours" },
  { slug: "hydra-tool-rent-20h", name: "Hydra Tool — Aluguel 20 Horas (Sem Dongle)", brandName: "Hydra Tool", brandSlug: "hydra-tool", externalId: "3002", duration: "20 Hour" },
  { slug: "lazy-login-tool-realme", name: "Lazy Login Tool — Realme (Acesso 24x7)", brandName: "Lazy Login Tool", brandSlug: "lazy-login-tool", externalId: "52", duration: "24x7 Server Access" },
  { slug: "mdm-fix-tool-rent-6h", name: "MDM FIX Tool — Aluguel 6 Horas", brandName: "MDM FIX Tool", brandSlug: "mdm-fix-tool", externalId: "2202", duration: "6 Hours" },
  { slug: "meow-login-tool-realme", name: "Meow Login Tool — Realme (Auth OTP)", brandName: "Meow Login Tool", brandSlug: "meow-login-tool", externalId: "1638", duration: null },
  { slug: "mrt-tool-rent-24h", name: "MRT Tool — Aluguel 24 Horas", brandName: "MRT Tool", brandSlug: "mrt-tool", externalId: "2206", duration: "24hours" },
  { slug: "kg-killer-tool-rent-4h", name: "KG Killer Tool — Aluguel 4 Horas", brandName: "KG Killer Tool", brandSlug: "kg-killer-tool", externalId: "2203", duration: "4 Hours" },
  { slug: "tfm-tool-rent-5h", name: "TFM Tool — Aluguel 5 Horas", brandName: "TFM Tool", brandSlug: "tfm-tool", externalId: "2200", duration: "5 Hours" },
  { slug: "uat-pro-tool-rent-2h", name: "UAT PRO TOOL — Aluguel 2 Horas", brandName: "UAT PRO TOOL", brandSlug: "uat-pro-tool", externalId: "2195", duration: "2 hours" },
  { slug: "tr-tool-rent-24h", name: "TR Tool — Aluguel 24 Horas", brandName: "TR Tool", brandSlug: "tr-tool", externalId: "2196", duration: "24 Hour" },
].map((p) => ({ ...p, type: "RENTAL", deliveryType: "AUTOMATIC", categoryId: CATEGORY_ID }));

// ---------------------------------------------------------------------------
// Produtos com variantes (mesma ferramenta/marca, dispositivo ou tier
// diferente — nunca duração alternativa ambígua).
// ---------------------------------------------------------------------------
const VARIANT_PRODUCTS = [
  {
    slug: "gapro-login-tool", name: "GAPro Login Tool", brandName: "GAPro Login Tool", brandSlug: "gapro-login-tool",
    type: "RENTAL", deliveryType: "AUTOMATIC", categoryId: CATEGORY_ID,
    variants: [
      { code: "oneplus-otp", externalId: "1255", sortOrder: 1 },
      { code: "realme-rcsm-otp", externalId: "1254", sortOrder: 2 },
    ],
  },
  {
    // Reaproveita o Product placeholder já existente (griffin-unlocker-aluguel),
    // criado sem vínculo técnico antes desta fase — não duplicar.
    slug: "griffin-unlocker-aluguel", name: "Griffin Unlocker", brandId: "cmtwdag7h0006tx209rp7g5fd",
    type: "RENTAL", deliveryType: "AUTOMATIC", categoryId: CATEGORY_ID,
    variants: [
      { code: "nao-premium-6h", externalId: "2996", sortOrder: 1 },
      { code: "premium-5h", externalId: "2999", sortOrder: 2 },
    ],
  },
  {
    slug: "oplus-pro-login", name: "OplusPro Login", brandName: "OplusPro Login", brandSlug: "oplus-pro-login",
    type: "RENTAL", deliveryType: "AUTOMATIC", categoryId: CATEGORY_ID,
    variants: [
      { code: "oneplus-otp", externalId: "82", sortOrder: 1 },
      { code: "realme-otp", externalId: "80", sortOrder: 2 },
      { code: "tecno-infinix-itel-loader", externalId: "3325", sortOrder: 3 },
    ],
  },
  {
    slug: "rft-loader-otp-login-tool", name: "RFT Loader OTP Login Tool", brandName: "RFT Loader OTP Login Tool", brandSlug: "rft-loader-otp-login-tool",
    type: "RENTAL", deliveryType: "AUTOMATIC", categoryId: CATEGORY_ID,
    variants: [
      { code: "oneplus", externalId: "408", sortOrder: 1 },
      { code: "oppo", externalId: "410", sortOrder: 2 },
      { code: "realme", externalId: "409", sortOrder: 3 },
    ],
  },
];

const report = { CREATE: [], UPDATE: [], UNCHANGED: [], BLOCKED: [], ALTERNATIVE_SOURCE: [], EXCLUDED: [] };
const analyzedExternalIds = new Set();
function log(bucket, family, detail, externalId) {
  report[bucket].push({ family, detail });
  if (externalId) analyzedExternalIds.add(externalId);
}

async function getProviderProduct(externalId) {
  return prisma.providerProduct.findUnique({
    where: { providerId_externalProductId: { providerId: PID, externalProductId: externalId } },
  });
}

function deriveDescription(items) {
  const parts = items.map((item) => {
    const desc = item.metadata?.providerDescription;
    return desc && desc.trim() ? desc.trim() : item.label;
  });
  return { text: parts.join(" | "), source: items.some((i) => i.metadata?.providerDescription) ? "MIXED" : "TITLE_ONLY" };
}

async function ensureBrand(name, slug) {
  const existing = await prisma.brand.findUnique({ where: { slug } });
  if (existing) return existing.id;
  log("CREATE", "BRAND", `${name} (${slug})`);
  if (!EXECUTE) return `dry-run:${slug}`;
  const created = await prisma.brand.create({ data: { name, slug, active: true } });
  return created.id;
}
async function resolveBrandId(config) {
  if (config.brandId) return config.brandId;
  return ensureBrand(config.brandName, config.brandSlug);
}

async function implementSimpleProduct(config) {
  const pp = await getProviderProduct(config.externalId);
  if (!pp) return log("BLOCKED", config.slug, `${config.externalId}: ProviderProduct não encontrado (divergência da revalidação)`, config.externalId);
  if (!pp.active || pp.technicalEligibility !== "READY" || pp.automationClass !== "AUTO_CREDENTIAL" || pp.expectedDeliveryType !== "CREDENTIALS" || !pp.providerCostCents) {
    return log("BLOCKED", config.slug, `${config.externalId}: não elegível hoje (active=${pp.active}, elig=${pp.technicalEligibility}, class=${pp.automationClass}, delivery=${pp.expectedDeliveryType}, cost=${pp.providerCostCents})`, config.externalId);
  }
  const suggested = suggestedPriceFor(pp.providerCostCents, pp.currency, config.type);
  if (!suggested) return log("BLOCKED", config.slug, `${config.externalId}: pricing engine não retornou preço válido`, config.externalId);
  const { text: description, source } = deriveDescription([pp]);
  const brandId = await resolveBrandId(config);
  const existing = await prisma.product.findUnique({ where: { slug: config.slug } });
  const data = {
    slug: config.slug, name: config.name, description, type: config.type, deliveryType: config.deliveryType,
    priceCents: suggested, normalPriceCents: suggested, status: "PUBLISHED",
    categoryId: config.categoryId, brandId,
    ...(config.duration ? { duration: config.duration } : {}),
  };
  if (existing) {
    const changed = existing.priceCents !== suggested || existing.status !== "PUBLISHED" || existing.description !== description;
    log(changed ? "UPDATE" : "UNCHANGED", config.slug, `${config.externalId} "${pp.label}" -> R$${(suggested / 100).toFixed(2)} [DESCRIPTION_SOURCE=${source}] [REUSED existing product]`, config.externalId);
    if (EXECUTE && changed) await prisma.product.update({ where: { id: existing.id }, data });
    if (EXECUTE) await prisma.providerProduct.update({ where: { id: pp.id }, data: { productId: existing.id } });
  } else {
    log("CREATE", config.slug, `${config.externalId} "${pp.label}" -> R$${(suggested / 100).toFixed(2)} [DESCRIPTION_SOURCE=${source}]`, config.externalId);
    if (EXECUTE) {
      const created = await prisma.product.create({ data });
      await prisma.providerProduct.update({ where: { id: pp.id }, data: { productId: created.id } });
    }
  }
}

async function implementVariantProduct(config) {
  const resolved = [];
  for (const v of config.variants) {
    const pp = await getProviderProduct(v.externalId);
    if (!pp) { log("BLOCKED", config.slug, `${v.externalId}: ProviderProduct não encontrado`, v.externalId); continue; }
    if (!pp.active || pp.technicalEligibility !== "READY" || pp.automationClass !== "AUTO_CREDENTIAL" || pp.expectedDeliveryType !== "CREDENTIALS" || !pp.providerCostCents) {
      log("BLOCKED", config.slug, `${v.externalId} "${pp.label}": não elegível (active=${pp.active}, elig=${pp.technicalEligibility}, class=${pp.automationClass}, cost=${pp.providerCostCents})`, v.externalId);
      continue;
    }
    const suggested = suggestedPriceFor(pp.providerCostCents, pp.currency, config.type);
    if (!suggested) { log("BLOCKED", config.slug, `${v.externalId}: pricing engine não retornou preço válido`, v.externalId); continue; }
    resolved.push({ ...v, pp, suggested });
  }
  if (!resolved.length) return log("BLOCKED", config.slug, `nenhuma variante elegível, produto não criado/publicado`);

  const brandId = await resolveBrandId(config);
  const { text: description, source } = deriveDescription(resolved.map((r) => r.pp));
  const minPrice = Math.min(...resolved.map((r) => r.suggested));
  let existing = await prisma.product.findUnique({ where: { slug: config.slug }, include: { variants: true } });
  const productData = {
    slug: config.slug, name: config.name, description, type: config.type, deliveryType: config.deliveryType,
    priceCents: minPrice, normalPriceCents: minPrice, status: "PUBLISHED",
    categoryId: config.categoryId, brandId,
  };
  const reusedNote = existing ? " [REUSED existing product]" : "";
  if (!existing) {
    log("CREATE", config.slug, `novo Product, ${resolved.length} variantes [DESCRIPTION_SOURCE=${source}]`);
    if (EXECUTE) existing = await prisma.product.create({ data: productData, include: { variants: true } });
  } else {
    const changed = existing.priceCents !== minPrice || existing.status !== "PUBLISHED";
    log(changed ? "UPDATE" : "UNCHANGED", config.slug, `a partir de R$${(minPrice / 100).toFixed(2)}${reusedNote}`);
    if (EXECUTE && changed) await prisma.product.update({ where: { id: existing.id }, data: productData });
  }
  for (const r of resolved) {
    const existingVariant = existing?.variants?.find((v) => v.code === r.code);
    log(existingVariant ? "UPDATE" : "CREATE", config.slug, `${r.code} (${r.externalId}) "${r.pp.label}" -> R$${(r.suggested / 100).toFixed(2)}`, r.externalId);
    if (!EXECUTE) continue;
    if (existingVariant) {
      await prisma.productVariant.update({ where: { id: existingVariant.id }, data: { pricingMode: "MANUAL", manualPriceCents: r.suggested, sortOrder: r.sortOrder } });
    } else {
      await prisma.productVariant.create({
        data: { productId: existing.id, providerProductId: r.pp.id, name: r.pp.label, code: r.code, sortOrder: r.sortOrder, pricingMode: "MANUAL", manualPriceCents: r.suggested },
      });
    }
  }
  if (EXECUTE) await recalculateVariants(resolved.map((r) => r.pp.id));
}

async function main() {
  console.log(`MODE: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);

  for (const item of ALTERNATIVE_SOURCES) log("ALTERNATIVE_SOURCE", item.of, `${item.externalId}: ${item.reason}`, item.externalId);
  for (const item of BLOCKED) log("BLOCKED", "TFM Tool", `${item.externalId} "${item.label}": ${item.reason}`, item.externalId);
  for (const item of ALREADY_PUBLISHED_UNTOUCHED) log("UNCHANGED", item.of, `${item.externalId}: já publicado anteriormente nesta mesma signature, não tocado por este script`, item.externalId);

  for (const config of SIMPLE_PRODUCTS) await implementSimpleProduct(config);
  for (const config of VARIANT_PRODUCTS) await implementVariantProduct(config);

  for (const bucket of ["CREATE", "UPDATE", "UNCHANGED", "BLOCKED", "ALTERNATIVE_SOURCE", "EXCLUDED"]) {
    console.log(`\n=== ${bucket} (${report[bucket].length}) ===`);
    for (const { family, detail } of report[bucket]) console.log(`[${family}] ${detail}`);
  }
  console.log(`\nRECONCILIAÇÃO: externalIds distintos analisados nesta fase = ${analyzedExternalIds.size} (esperado: 35)`);
  const expected35 = new Set([
    "2216","2995","2337","2214","2213","2212","2338","2211","4349","1255","1254","2210","3002","52","2336",
    "1638","2206","82","80","3325","2203","2202","2200","2333","2999","2996","408","410","409","2335","2196",
    "2334","2998","2195","2194",
  ]);
  const missing = [...expected35].filter((id) => !analyzedExternalIds.has(id));
  const extra = [...analyzedExternalIds].filter((id) => !expected35.has(id));
  if (missing.length) console.log("FALTANDO na análise:", missing.join(", "));
  if (extra.length) console.log("EXTRA não esperado na análise:", extra.join(", "));
  if (!missing.length && !extra.length) console.log("OK: todos os 35 externalIds do cluster foram classificados (analisados ou explicitamente fora do escopo por já publicados).");
}

main()
  .catch((e) => { console.error("ERROR", e.message, e.stack); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
