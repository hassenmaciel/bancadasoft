// Implantação comercial das 4 famílias prioritárias HeartUnlocks (FRPFILE,
// UnlockTool licença, Phoenix ServiceTool, SamsungTool).
//
// Idempotente e escopado SOMENTE aos externalIds explicitamente aprovados
// abaixo. Nunca toca em nenhum dos outros 1.788 ProviderProducts não
// aprovados, nem no ProviderProduct 2194 (UnlockTool 6h, já publicado e
// funcional) nem em nenhum ProviderOrder/Order/Payment/User existente.
//
// Uso:
//   node --env-file=.env --experimental-strip-types scripts/implement-priority-catalog.mjs
//     (DRY-RUN por padrão: mostra CREATE/UPDATE/UNCHANGED/BLOCKED, não escreve nada)
//   node --env-file=.env --experimental-strip-types scripts/implement-priority-catalog.mjs --execute
//     (aplica as alterações)

import { PrismaClient } from "@prisma/client";
import { calculatePricing } from "../src/lib/pricing.ts";

// pricing-service.ts importa "./prisma" sem extensão, o que o loader ESM puro
// do Node (fora do Next.js) não resolve. Em vez de tocar em código de app só
// para rodar este script, replica-se aqui o mesmo cálculo que
// variantPricingUpdateData()/calculateVariantPricing() fazem em
// src/lib/pricing-service.ts — a fórmula real (calculatePricing) continua
// sendo a mesma função importada, nada de novo é inventado.
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
// FRPFILE: os 12 Products/28 ProductVariants já existem (seed anterior).
// Só falta precificar as variantes elegíveis e publicar. As duas variantes
// com holdReason documentado (formato de campo não confirmado) ficam de fora,
// exatamente como já estão hoje.
// ---------------------------------------------------------------------------
const FRPFILE_HELD_BACK = new Set(["frpfile-variant-3175", "frpfile-variant-230"]);

// ---------------------------------------------------------------------------
// UnlockTool — Licença/Ativação (Product novo). Fonte escolhida: SOURCE A
// (unlocktool Reseller: 4661/4662/4663) — mais barata nas 3 durações e com
// technicalEligibility READY/ativa. SOURCE B (2067/2068/2069) documentada
// como alternativa, não vinculada. 2333 (rental "Source 2") e 58
// (administrativo) não são tocados.
// ---------------------------------------------------------------------------
const UNLOCKTOOL_LICENSE = {
  slug: "unlocktool-licenca-ativacao",
  name: "UnlockTool — Licença / Ativação",
  brandId: "cmtwdafsn0001tx20xl59gho1", // Brand UnlockTool (já existe, reused)
  categoryId: "cmtuuzwer0000tx5kl9b2k11w", // Category Ferramentas (já existe, reused)
  type: "LICENSE",
  deliveryType: "AUTOMATIC",
  variants: [
    { code: "3-meses", externalId: "4662", sortOrder: 1 },
    { code: "6-meses", externalId: "4661", sortOrder: 2 },
    { code: "12-meses", externalId: "4663", sortOrder: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Phoenix ServiceTool — único ProviderProduct comprovado pela auditoria.
// Product simples, sem variante, vínculo direto (mesmo padrão de AMT/CF
// Tools/DFT Pro).
// ---------------------------------------------------------------------------
const PHOENIX = {
  slug: "phoenix-servicetool-nokia-hmd-frp",
  name: "Phoenix Service Tool — Nokia HMD (FRP Server)",
  brandName: "Phoenix ServiceTool",
  brandSlug: "phoenix-servicetool",
  categoryId: "cmtuuzwer0000tx5kl9b2k11w",
  type: "TOOL",
  deliveryType: "AUTOMATIC",
  externalId: "1808",
};

// ---------------------------------------------------------------------------
// SamsungTool — dois cards comercialmente distintos (categoryName diferente
// na HeartUnlocks: "Samsung Tool, KG Bypass" vs "Remote Default Group"),
// conforme exigido explicitamente (não esconder diferença comercial).
// ---------------------------------------------------------------------------
const SAMSUNGTOOL_KG = {
  slug: "samsungtool-kg-bypass",
  name: "SamsungTool — KG Bypass",
  brandName: "SamsungTool",
  brandSlug: "samsungtool",
  categoryId: "cmtuuzwer0000tx5kl9b2k11w",
  type: "LICENSE",
  deliveryType: "AUTOMATIC",
  variants: [
    { code: "3-meses", externalId: "65", sortOrder: 1 },
    { code: "6-meses", externalId: "3323", sortOrder: 2 },
    { code: "12-meses", externalId: "64", sortOrder: 3 },
    { code: "1-dia-10-creditos", externalId: "3321", sortOrder: 4 },
    { code: "creditos-usuario-existente", externalId: "3322", sortOrder: 5 },
  ],
};
const SAMSUNGTOOL_US_RENTAL = {
  slug: "samsungtool-us-aluguel-10h",
  name: "SamsungTool.us — Aluguel 10 Horas (Celltool)",
  brandName: "SamsungTool", // mesma ferramenta, oferta comercial diferente
  brandSlug: "samsungtool",
  categoryId: "cmtuuzwer0000tx5kl9b2k11w",
  type: "RENTAL",
  deliveryType: "AUTOMATIC",
  externalId: "2182",
};

const report = { CREATE: [], UPDATE: [], UNCHANGED: [], BLOCKED: [] };
function log(bucket, family, detail) {
  report[bucket].push({ family, detail });
}

async function getProviderProduct(externalId) {
  return prisma.providerProduct.findUnique({
    where: { providerId_externalProductId: { providerId: PID, externalProductId: externalId } },
  });
}

// Deriva descrição comercial SOMENTE de dados reais do provider (label,
// providerDescription). Sem IA, sem texto inventado, sem busca externa
// (seção 21). Quando providerDescription é null, o título completo vira a
// única fonte (DESCRIPTION_SOURCE=TITLE_ONLY).
function deriveDescription(items) {
  const parts = items.map((item) => {
    const desc = item.metadata?.providerDescription;
    return desc && desc.trim() ? desc.trim() : item.label;
  });
  return { text: parts.join(" | "), source: items.some((i) => i.metadata?.providerDescription) ? "MIXED" : "TITLE_ONLY" };
}

async function implementFrpfile() {
  const products = await prisma.product.findMany({
    where: { id: { startsWith: "frpfile-" } },
    include: { variants: { include: { providerProduct: true } } },
  });
  for (const product of products) {
    const pricedVariants = [];
    for (const variant of product.variants) {
      if (FRPFILE_HELD_BACK.has(variant.id)) {
        log("BLOCKED", "FRPFILE", `${variant.id} (${variant.providerProduct.externalProductId}): holdReason já documentado, mantido fora da publicação`);
        continue;
      }
      const pp = variant.providerProduct;
      if (!pp.active || pp.technicalEligibility !== "READY" || !pp.providerCostCents) {
        log("BLOCKED", "FRPFILE", `${variant.id} (${pp.externalProductId}): não elegível (active=${pp.active}, elig=${pp.technicalEligibility}, cost=${pp.providerCostCents})`);
        continue;
      }
      const suggested = suggestedPriceFor(pp.providerCostCents, pp.currency, product.type);
      if (!suggested) {
        log("BLOCKED", "FRPFILE", `${variant.id} (${pp.externalProductId}): pricing engine não retornou preço válido`);
        continue;
      }
      const needsUpdate = variant.pricingMode !== "MANUAL" || variant.manualPriceCents !== suggested || variant.priceCents !== suggested;
      pricedVariants.push({ variant, pp, suggested });
      log(needsUpdate ? "UPDATE" : "UNCHANGED", "FRPFILE", `${variant.id} (${pp.externalProductId}) "${pp.label}" -> R$${(suggested / 100).toFixed(2)}`);
      if (EXECUTE && needsUpdate) {
        await prisma.productVariant.update({
          where: { id: variant.id },
          data: { pricingMode: "MANUAL", manualPriceCents: suggested },
        });
      }
    }
    if (!pricedVariants.length) {
      log("BLOCKED", "FRPFILE", `${product.id}: nenhuma variante elegível, produto permanece DRAFT`);
      continue;
    }
    if (EXECUTE) {
      await recalculateVariants(pricedVariants.map(({ pp }) => pp.id));
    }
    const minPrice = Math.min(...pricedVariants.map(({ suggested }) => suggested));
    const productNeedsUpdate = product.status !== "PUBLISHED" || product.priceCents !== minPrice;
    log(productNeedsUpdate ? "UPDATE" : "UNCHANGED", "FRPFILE", `${product.id}: status DRAFT->PUBLISHED, priceCents(a partir de)=${minPrice}`);
    if (EXECUTE && productNeedsUpdate) {
      await prisma.product.update({
        where: { id: product.id },
        data: { status: "PUBLISHED", priceCents: minPrice, normalPriceCents: minPrice },
      });
    }
  }
}

async function resolveBrandId(config) {
  if (config.brandId) return config.brandId;
  return ensureBrand(config.brandName, config.brandSlug);
}

async function ensureBrand(name, slug) {
  const existing = await prisma.brand.findUnique({ where: { slug } });
  if (existing) return existing.id;
  log(EXECUTE ? "CREATE" : "CREATE", "BRAND", `${name} (${slug})`);
  if (!EXECUTE) return `dry-run:${slug}`;
  const created = await prisma.brand.create({ data: { name, slug, active: true } });
  return created.id;
}

async function implementSimpleDirectProduct(config, family) {
  const pp = await getProviderProduct(config.externalId);
  if (!pp) return log("BLOCKED", family, `${config.externalId}: ProviderProduct não encontrado (divergência da auditoria)`);
  if (!pp.active || pp.technicalEligibility !== "READY" || !pp.providerCostCents) {
    return log("BLOCKED", family, `${config.externalId}: não elegível hoje (active=${pp.active}, elig=${pp.technicalEligibility}, cost=${pp.providerCostCents})`);
  }
  const existing = await prisma.product.findUnique({ where: { slug: config.slug } });
  const suggested = suggestedPriceFor(pp.providerCostCents, pp.currency, config.type);
  if (!suggested) return log("BLOCKED", family, `${config.externalId}: pricing engine não retornou preço válido`);
  const { text: description, source } = deriveDescription([pp]);
  const brandId = await resolveBrandId(config);
  const data = {
    slug: config.slug,
    name: config.name,
    description,
    type: config.type,
    deliveryType: config.deliveryType,
    priceCents: suggested,
    normalPriceCents: suggested,
    status: "PUBLISHED",
    categoryId: config.categoryId,
    brandId,
  };
  if (existing) {
    const changed = existing.priceCents !== suggested || existing.status !== "PUBLISHED" || existing.description !== description;
    log(changed ? "UPDATE" : "UNCHANGED", family, `${config.slug} (${config.externalId}) -> R$${(suggested / 100).toFixed(2)} [DESCRIPTION_SOURCE=${source}]`);
    if (EXECUTE && changed) await prisma.product.update({ where: { id: existing.id }, data });
    if (EXECUTE) await prisma.providerProduct.update({ where: { id: pp.id }, data: { productId: existing.id } });
  } else {
    log("CREATE", family, `${config.slug} (${config.externalId}) -> R$${(suggested / 100).toFixed(2)} [DESCRIPTION_SOURCE=${source}]`);
    if (EXECUTE) {
      const created = await prisma.product.create({ data });
      await prisma.providerProduct.update({ where: { id: pp.id }, data: { productId: created.id } });
    }
  }
}

async function implementVariantProduct(config, family) {
  const resolved = [];
  for (const v of config.variants) {
    const pp = await getProviderProduct(v.externalId);
    if (!pp) {
      log("BLOCKED", family, `${v.externalId}: ProviderProduct não encontrado (divergência da auditoria)`);
      continue;
    }
    if (!pp.active || pp.technicalEligibility !== "READY" || !pp.providerCostCents) {
      log("BLOCKED", family, `${v.externalId} "${pp.label}": não elegível hoje (active=${pp.active}, elig=${pp.technicalEligibility}, cost=${pp.providerCostCents})`);
      continue;
    }
    const suggested = suggestedPriceFor(pp.providerCostCents, pp.currency, config.type);
    if (!suggested) {
      log("BLOCKED", family, `${v.externalId}: pricing engine não retornou preço válido`);
      continue;
    }
    resolved.push({ ...v, pp, suggested });
  }
  if (!resolved.length) return log("BLOCKED", family, `${config.slug}: nenhuma variante elegível, produto não criado/publicado`);

  const brandId = await resolveBrandId(config);
  const { text: description, source } = deriveDescription(resolved.map((r) => r.pp));
  const minPrice = Math.min(...resolved.map((r) => r.suggested));
  let existing = await prisma.product.findUnique({ where: { slug: config.slug }, include: { variants: true } });
  const productData = {
    slug: config.slug,
    name: config.name,
    description,
    type: config.type,
    deliveryType: config.deliveryType,
    priceCents: minPrice,
    normalPriceCents: minPrice,
    status: "PUBLISHED",
    categoryId: config.categoryId,
    brandId,
  };
  if (!existing) {
    log("CREATE", family, `${config.slug}: novo Product, ${resolved.length} variantes [DESCRIPTION_SOURCE=${source}]`);
    if (EXECUTE) existing = await prisma.product.create({ data: productData, include: { variants: true } });
  } else {
    const changed = existing.priceCents !== minPrice || existing.status !== "PUBLISHED";
    log(changed ? "UPDATE" : "UNCHANGED", family, `${config.slug}: Product existente, a partir de R$${(minPrice / 100).toFixed(2)}`);
    if (EXECUTE && changed) await prisma.product.update({ where: { id: existing.id }, data: productData });
  }
  for (const r of resolved) {
    const existingVariant = existing?.variants?.find((v) => v.code === r.code);
    log(
      existingVariant ? "UPDATE" : "CREATE",
      family,
      `${config.slug}/${r.code} (${r.externalId}) "${r.pp.label}" -> R$${(r.suggested / 100).toFixed(2)}`,
    );
    if (!EXECUTE) continue;
    if (existingVariant) {
      await prisma.productVariant.update({
        where: { id: existingVariant.id },
        data: { pricingMode: "MANUAL", manualPriceCents: r.suggested, sortOrder: r.sortOrder },
      });
    } else {
      const createdVariant = await prisma.productVariant.create({
        data: {
          productId: existing.id,
          providerProductId: r.pp.id,
          name: r.pp.label,
          code: r.code,
          sortOrder: r.sortOrder,
          pricingMode: "MANUAL",
          manualPriceCents: r.suggested,
        },
      });
      void createdVariant;
    }
  }
  if (EXECUTE) await recalculateVariants(resolved.map((r) => r.pp.id));
}

async function main() {
  console.log(`MODE: ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  await implementFrpfile();
  await implementVariantProduct(UNLOCKTOOL_LICENSE, "UNLOCKTOOL");
  await implementSimpleDirectProduct(PHOENIX, "PHOENIX");
  await implementVariantProduct(SAMSUNGTOOL_KG, "SAMSUNGTOOL");
  await implementSimpleDirectProduct(SAMSUNGTOOL_US_RENTAL, "SAMSUNGTOOL");

  for (const bucket of ["CREATE", "UPDATE", "UNCHANGED", "BLOCKED"]) {
    console.log(`\n=== ${bucket} (${report[bucket].length}) ===`);
    for (const { family, detail } of report[bucket]) console.log(`[${family}] ${detail}`);
  }
}

main()
  .catch((e) => {
    console.error("ERROR", e.message, e.stack);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
