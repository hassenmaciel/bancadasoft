// Cria a base comercial da Revenda de Licença Anual do AdClean: o Provider
// "adclean-license" (independente do "adclean" do ticket avulso), um
// ProviderProduct por período (metadata.periodo_horas: 12h / 6 meses / 1 ano)
// e o Product "AdClean — Licença" (ProductType.TOOL) com 3 variantes.
//
// Tudo nasce desligado: Provider active=false/NOT_CONNECTED (mesmo padrão da
// migration do AdClean v2), Product DRAFT/available=false e variantes com
// publicationBlocked=true até o preço de venda ser definido no admin. NÃO toca
// em nenhum Product/Provider/ProviderProduct existente, no fulfillment-engine,
// no schema nem no sync. Nenhum commit/push é feito por este script.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-adclean-license.mjs
//   ESCRITA (somente com aprovação explícita; tudo numa única transação):
//     CONFIRM_ADCLEAN_LICENSE_SETUP=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-adclean-license.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const CONFIRM_ENV = "CONFIRM_ADCLEAN_LICENSE_SETUP";

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------
export const PROVIDER = {
  code: "adclean-license",
  name: "AdClean — Licença (revenda)",
  active: false,
  apiBaseUrl: "https://repair-adclean-licenca.adclean-ha100.workers.dev",
  integrationStatus: "NOT_CONNECTED",
};

export const PERIODS = [
  { code: "12h", externalId: "licenca-12h", name: "12 horas", periodoHoras: 12, sortOrder: 1 },
  { code: "6-meses", externalId: "licenca-4320h", name: "6 meses", periodoHoras: 4320, sortOrder: 2 },
  { code: "1-ano", externalId: "licenca-8760h", name: "1 ano", periodoHoras: 8760, sortOrder: 3 },
];

export const CATEGORY_SLUG = "ferramentas";

export const HOLD_REASON = "Preço de venda a definir no admin.";

export const PRODUCT = {
  slug: "adclean-licenca",
  name: "AdClean — Licença",
  description: "Licença do Repair AdClean por período (12 horas, 6 meses ou 1 ano).",
  longDescription:
    "Após a confirmação do pagamento, o próprio AdClean envia o código de ativação para o e-mail da sua conta BancadaSoft. Use o código no aplicativo AdClean com esse mesmo e-mail.",
  type: "TOOL",
  deliveryType: "AUTOMATIC",
  deliveryEstimate: "Código enviado por e-mail pelo AdClean após a confirmação do pagamento",
  searchTerms: "adclean repair licenca anual ativacao codigo",
  priceCents: 0,
  priceVisibility: "PUBLIC",
  pricingMode: "MANUAL",
  pricingStatus: "NEEDS_REVIEW",
  manualPriceCents: null,
  status: "DRAFT",
  available: false,
  featured: false,
};

// ---------------------------------------------------------------------------
// Construção dos dados (puro, testável sem banco)
// ---------------------------------------------------------------------------
export function providerProductData(period, providerId) {
  return {
    providerId,
    productId: null, // vínculo é pela variante
    externalProductId: period.externalId,
    label: `AdClean — Licença ${period.name}`,
    providerCostCents: null,
    currency: "BRL",
    active: true,
    mode: "REAL",
    metadata: { periodo_horas: period.periodoHoras },
    automationClass: "AUTO_FIELD_BASED",
    technicalEligibility: "READY",
    homologationStatus: "UNTESTED",
    expectedDeliveryType: "CODE",
  };
}

export function variantData(period, productId, providerProductId) {
  return {
    productId,
    providerProductId,
    name: period.name,
    code: period.code,
    active: true,
    sortOrder: period.sortOrder,
    priceCents: null,
    normalPriceCents: null,
    premiumPriceCents: null,
    pricingMode: "MANUAL",
    manualPriceCents: null,
    pricingStatus: "NEEDS_REVIEW",
    publicationBlocked: true,
    holdReason: HOLD_REASON,
  };
}

// Pré-condições: nada do plano pode existir ainda; a categoria precisa existir.
export function preconditionProblems(state) {
  const problems = [];
  if (state.provider) problems.push(`Provider "${PROVIDER.code}" já existe (id ${state.provider.id})`);
  for (const pp of state.providerProducts ?? [])
    problems.push(`ProviderProduct ${pp.externalProductId} já existe (id ${pp.id})`);
  if (state.product) problems.push(`Product "${PRODUCT.slug}" já existe (id ${state.product.id})`);
  if (!state.category) problems.push(`Categoria "${CATEGORY_SLUG}" não encontrada`);
  else if (!state.category.active) problems.push(`Categoria "${CATEGORY_SLUG}" inativa`);
  return problems;
}

export function revertSql() {
  return [
    `DELETE FROM "ProductVariant" WHERE "productId" = (SELECT id FROM "Product" WHERE slug = '${PRODUCT.slug}');`,
    `DELETE FROM "Product" WHERE slug = '${PRODUCT.slug}';`,
    `DELETE FROM "ProviderProduct" WHERE "providerId" = (SELECT id FROM "Provider" WHERE code = '${PROVIDER.code}');`,
    `DELETE FROM "Provider" WHERE code = '${PROVIDER.code}';`,
    "-- Só é seguro enquanto não houver OrderItem/ProviderOrder ligados à licença.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);
const yes = (ok) => (ok ? "OK" : "FALHOU");

export function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

async function loadState(db) {
  const [provider, providerProducts, product, category] = await Promise.all([
    db.provider.findUnique({ where: { code: PROVIDER.code }, select: { id: true } }),
    db.providerProduct.findMany({
      where: { externalProductId: { in: PERIODS.map((p) => p.externalId) }, provider: { code: PROVIDER.code } },
      select: { id: true, externalProductId: true },
    }),
    db.product.findUnique({ where: { slug: PRODUCT.slug }, select: { id: true } }),
    db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, active: true } }),
  ]);
  return { provider, providerProducts, product, category };
}

async function counts(db) {
  const [providers, providerProducts, products, variants, orderItems] = await Promise.all([
    db.provider.count(),
    db.providerProduct.count(),
    db.product.count(),
    db.productVariant.count(),
    db.orderItem.count(),
  ]);
  return { providers, providerProducts, products, variants, orderItems };
}

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    line(`MODE: ${mode}${mode === "DRY_RUN" ? " (somente SELECTs; nenhuma escrita)" : " (escreve; uma única transação)"}`);
    line(`ADCLEAN_LICENSE_PARTNER_TOKEN no ambiente: ${process.env.ADCLEAN_LICENSE_PARTNER_TOKEN?.trim() ? "sim" : "NÃO (adapter ficará desconectado)"}`);

    const before = await counts(db);
    line(`contagens atuais: ${JSON.stringify(before)}`);

    const state = await loadState(db);
    const problems = preconditionProblems(state);
    line("\n-- Pré-condições --");
    if (problems.length) {
      for (const problem of problems) line(`  [FALHOU] ${problem}`);
      line("\nABORTADO: nada foi alterado.");
      return;
    }
    line(`  [OK] Provider "${PROVIDER.code}" ainda não existe`);
    line(`  [OK] nenhum ProviderProduct ${PERIODS.map((p) => p.externalId).join("/")} existe`);
    line(`  [OK] Product "${PRODUCT.slug}" ainda não existe`);
    line(`  [OK] categoria "${CATEGORY_SLUG}" existe e está ativa`);

    line("\n-- Plano --");
    line(`  Provider: ${JSON.stringify(PROVIDER)}`);
    for (const period of PERIODS) line(`  ProviderProduct: ${JSON.stringify(providerProductData(period, "<provider.id>"))}`);
    line(`  Product: ${JSON.stringify({ ...PRODUCT, categoryId: `<${CATEGORY_SLUG}.id>` })}`);
    for (const period of PERIODS)
      line(`  ProductVariant: ${JSON.stringify(variantData(period, "<product.id>", `<pp ${period.externalId}>`))}`);

    if (mode !== "APPLY") {
      line(`\n[DRY-RUN] nada foi escrito. Próximo passo (só com aprovação): --apply com ${CONFIRM_ENV}=SIM.`);
      line("\n-- SQL de reversão (para depois de um --apply) --");
      line(revertSql());
      return;
    }

    await db.$transaction(async (tx) => {
      const fresh = await loadState(tx);
      const freshProblems = preconditionProblems(fresh);
      if (freshProblems.length) throw new Error(`ABORTADO (revalidação): ${freshProblems.join("; ")}`);
      const provider = await tx.provider.create({ data: PROVIDER });
      const product = await tx.product.create({ data: { ...PRODUCT, categoryId: fresh.category.id } });
      for (const period of PERIODS) {
        const pp = await tx.providerProduct.create({ data: providerProductData(period, provider.id) });
        await tx.productVariant.create({ data: variantData(period, product.id, pp.id) });
      }
    });
    const after = await counts(db);
    const expected = {
      ...before,
      providers: before.providers + 1,
      providerProducts: before.providerProducts + PERIODS.length,
      products: before.products + 1,
      variants: before.variants + PERIODS.length,
    };
    const same = JSON.stringify(after) === JSON.stringify(expected);
    line(`\n[${yes(same)}] contagens depois: ${JSON.stringify(after)} (esperado ${JSON.stringify(expected)})`);
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
