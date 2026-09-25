// Cria a base comercial da "Recarga de Saldo": o Provider interno
// "internal-balance", um ProviderProduct interno por pacote (valor creditado
// em metadata.creditAmountCents) e o Product "Recarga de Saldo"
// (ProductType.BALANCE_TOPUP) com 3 variantes de exemplo (R$10/R$30/R$50).
//
// O Product nasce DRAFT e available=false (não publica nada). NÃO toca em
// nenhum Product/Provider/ProviderProduct existente, no fulfillment-engine,
// no schema nem no sync. Nenhum commit/push é feito por este script.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-balance-topup.mjs
//   ESCRITA (somente com aprovação explícita; tudo numa única transação):
//     CONFIRM_BALANCE_TOPUP_SETUP=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-balance-topup.mjs --apply

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveProviderProduct } from "../src/lib/providers/selection.ts";

export const CONFIRM_ENV = "CONFIRM_BALANCE_TOPUP_SETUP";

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------
export const PROVIDER = {
  code: "internal-balance",
  name: "Saldo BancadaSoft (interno)",
  active: true,
  integrationStatus: "CONNECTED",
};

// Preço = valor creditado (sem desconto por nível: normal/premium ficam null
// de propósito — o crédito vem do metadata, nunca do preço pago).
export const PACKAGES = [
  { code: "recarga-10", externalId: "topup-1000", name: "Recarga de R$ 10,00", creditAmountCents: 1000, sortOrder: 1 },
  { code: "recarga-30", externalId: "topup-3000", name: "Recarga de R$ 30,00", creditAmountCents: 3000, sortOrder: 2 },
  { code: "recarga-50", externalId: "topup-5000", name: "Recarga de R$ 50,00", creditAmountCents: 5000, sortOrder: 3 },
];

export const CATEGORY_SLUG = "ferramentas";

export const PRODUCT = {
  slug: "recarga-de-saldo",
  name: "Recarga de Saldo",
  description: "Crédito pré-pago na sua conta BancadaSoft.",
  longDescription:
    "Escolha o valor e pague via PIX. Assim que o pagamento for confirmado, o valor é creditado no saldo da sua conta. Disponível apenas para contas com saldo habilitado.",
  type: "BALANCE_TOPUP",
  deliveryType: "AUTOMATIC",
  deliveryEstimate: "Imediato após a confirmação do PIX",
  searchTerms: "recarga saldo credito pre-pago",
  priceCents: PACKAGES[0].creditAmountCents,
  priceVisibility: "LOGIN_REQUIRED",
  pricingMode: "MANUAL",
  pricingStatus: "MANUAL",
  manualPriceCents: PACKAGES[0].creditAmountCents,
  status: "DRAFT",
  available: false,
  featured: false,
};

// ---------------------------------------------------------------------------
// Construção dos dados (puro, testável sem banco)
// ---------------------------------------------------------------------------
export function providerProductData(pkg, providerId) {
  return {
    providerId,
    productId: null, // vínculo é pela variante (mesmo modelo do Griffin)
    externalProductId: pkg.externalId,
    label: pkg.name,
    providerCostCents: null,
    currency: "BRL",
    active: true,
    mode: "REAL",
    metadata: { creditAmountCents: pkg.creditAmountCents },
    automationClass: "AUTO_FIELD_BASED",
    technicalEligibility: "READY",
    homologationStatus: "UNTESTED",
    expectedDeliveryType: "TEXT",
  };
}

export function variantData(pkg, productId, providerProductId) {
  return {
    productId,
    providerProductId,
    name: pkg.name,
    code: pkg.code,
    active: true,
    sortOrder: pkg.sortOrder,
    priceCents: pkg.creditAmountCents,
    normalPriceCents: null,
    premiumPriceCents: null,
    pricingMode: "MANUAL",
    manualPriceCents: pkg.creditAmountCents,
    pricingStatus: "MANUAL",
    publicationBlocked: false,
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

// Simula a resolução do checkout (resolveProviderProduct real) para o
// ProviderProduct planejado, no modo atual do site.
export function simulateResolution(pkg, siteMode) {
  const candidate = {
    id: `planned-${pkg.externalId}`,
    productId: null,
    externalProductId: pkg.externalId,
    active: true,
    mode: "REAL",
    providerCostCents: null,
    technicalEligibility: "READY",
    provider: { id: "planned-provider", code: PROVIDER.code, active: PROVIDER.active },
  };
  return resolveProviderProduct([candidate], siteMode).status;
}

export function revertSql() {
  return [
    `DELETE FROM "ProductVariant" WHERE "productId" = (SELECT id FROM "Product" WHERE slug = '${PRODUCT.slug}');`,
    `DELETE FROM "Product" WHERE slug = '${PRODUCT.slug}';`,
    `DELETE FROM "ProviderProduct" WHERE "providerId" = (SELECT id FROM "Provider" WHERE code = '${PROVIDER.code}');`,
    `DELETE FROM "Provider" WHERE code = '${PROVIDER.code}';`,
    "-- Só é seguro enquanto não houver OrderItem/ProviderOrder/AccountLedgerEntry ligados à recarga.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);
const yes = (ok) => (ok ? "OK" : "FALHOU");

function resolveMode(argv, env) {
  if (!argv.includes("--apply")) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM") throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

async function loadState(db) {
  const [provider, providerProducts, product, category] = await Promise.all([
    db.provider.findUnique({ where: { code: PROVIDER.code }, select: { id: true } }),
    db.providerProduct.findMany({
      where: { externalProductId: { in: PACKAGES.map((p) => p.externalId) }, provider: { code: PROVIDER.code } },
      select: { id: true, externalProductId: true },
    }),
    db.product.findUnique({ where: { slug: PRODUCT.slug }, select: { id: true } }),
    db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, active: true } }),
  ]);
  return { provider, providerProducts, product, category };
}

async function counts(db) {
  const [providers, providerProducts, products, variants, orderItems, ledger] = await Promise.all([
    db.provider.count(),
    db.providerProduct.count(),
    db.product.count(),
    db.productVariant.count(),
    db.orderItem.count(),
    db.accountLedgerEntry.count(),
  ]);
  return { providers, providerProducts, products, variants, orderItems, ledger };
}

async function main() {
  const mode = resolveMode(process.argv.slice(2), process.env);
  const db = new PrismaClient();
  try {
    line(`MODE: ${mode}${mode === "DRY_RUN" ? " (somente SELECTs; nenhuma escrita)" : " (escreve; uma única transação)"}`);
    const settings = await db.siteSettings.findUnique({ where: { id: "default" }, select: { providerMode: true } });
    const siteMode = settings?.providerMode ?? "TEST";
    line(`providerMode do site: ${siteMode}`);

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
    line(`  [OK] nenhum ProviderProduct ${PACKAGES.map((p) => p.externalId).join("/")} existe`);
    line(`  [OK] Product "${PRODUCT.slug}" ainda não existe`);
    line(`  [OK] categoria "${CATEGORY_SLUG}" existe e está ativa`);

    line("\n-- Simulação do checkout (resolveProviderProduct real, modo do site) --");
    for (const pkg of PACKAGES) {
      const status = simulateResolution(pkg, siteMode);
      line(`  [${yes(status === "SELECTED")}] ${pkg.code} -> ${status}${status === "SELECTED" ? "" : ` (ProviderProduct é REAL; site está em ${siteMode})`}`);
    }

    line("\n-- Plano --");
    line(`  Provider: ${JSON.stringify(PROVIDER)}`);
    for (const pkg of PACKAGES) line(`  ProviderProduct: ${JSON.stringify(providerProductData(pkg, "<provider.id>"))}`);
    line(`  Product: ${JSON.stringify({ ...PRODUCT, categoryId: "<ferramentas.id>" })}`);
    for (const pkg of PACKAGES) line(`  ProductVariant: ${JSON.stringify(variantData(pkg, "<product.id>", `<pp ${pkg.externalId}>`))}`);

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
      for (const pkg of PACKAGES) {
        const pp = await tx.providerProduct.create({ data: providerProductData(pkg, provider.id) });
        await tx.productVariant.create({ data: variantData(pkg, product.id, pp.id) });
      }
    });
    const after = await counts(db);
    const expected = {
      ...before,
      providers: before.providers + 1,
      providerProducts: before.providerProducts + PACKAGES.length,
      products: before.products + 1,
      variants: before.variants + PACKAGES.length,
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
