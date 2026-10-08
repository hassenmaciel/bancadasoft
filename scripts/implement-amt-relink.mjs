// Religação do Product "amt-aluguel": o ProviderProduct HeartUnlocks 2337
// ("Souce 2") saiu do catálogo ao vivo; o vínculo DIRETO
// (ProviderProduct.productId) passa para o 2216 ("Android Multi tool ( AMT)
// Rent 2 Hour").
//
// Escreve SOMENTE: productId do 2337 (-> null), productId do 2216 (-> produto)
// e 1 AuditLog. Nunca toca em status/preço do Product, Order, OrderItem,
// Payment, Fulfillment, ProviderOrder, outros ProviderProducts nem no sync.
// Pedidos antigos continuam íntegros: OrderItem/ProviderOrder guardam o id do
// ProviderProduct 2337, que não é apagado nem desativado.
//
// Uso:
//   DRY-RUN (padrão, só SELECTs):
//     node --env-file=.env --experimental-strip-types scripts/implement-amt-relink.mjs
//   ESCRITA (somente com aprovação explícita; 1 transação):
//     CONFIRM_AMT_RELINK=SIM node --env-file=.env --experimental-strip-types \
//       scripts/implement-amt-relink.mjs --apply [--actor=<email de um ADMIN>]

import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveProviderProduct } from "../src/lib/providers/selection.ts";

export const CONFIRM_ENV = "CONFIRM_AMT_RELINK";
export const PRODUCT_SLUG = "amt-aluguel";
export const PRODUCT_ID = "cmtwdahc6000ftx200g2h4ovq";
export const PROVIDER_CODE = "heartunlocks";
export const OLD_EXTERNAL_ID = "2337";
export const OLD_PP_ID = "cmty88rqt0155jq04x2m2hynt";
export const NEW_EXTERNAL_ID = "2216";
export const NEW_PP_ID = "cmty88rqh011rjq04i6rt5nem";
export const AUDIT_ACTION = "PRODUCT_PROVIDER_RELINKED";

// Modo padrão é DRY-RUN. Escrever exige --apply E a variável de confirmação.
export function resolveMode(argv, env) {
  const apply = argv.includes("--apply");
  if (!apply) return "DRY_RUN";
  if (env[CONFIRM_ENV] !== "SIM")
    throw new Error(`--apply exige ${CONFIRM_ENV}=SIM. Nada foi alterado.`);
  return "APPLY";
}

export const actorArg = (argv) =>
  argv.find((arg) => arg.startsWith("--actor="))?.slice("--actor=".length).trim().toLowerCase() || null;

// AuditLog.actorUserId é obrigatório (FK User). Sem --actor, só aceita quando
// existe exatamente 1 ADMIN ativo.
export function pickActor(admins, email) {
  if (email) {
    const found = admins.find((admin) => admin.email.toLowerCase() === email);
    return found ? { actor: found } : { problem: `--actor=${email} não é um ADMIN ativo` };
  }
  if (admins.length === 1) return { actor: admins[0] };
  return { problem: `${admins.length} ADMINs ativos — informe --actor=<email>` };
}

// Pré-condições (todas revalidadas dentro da transação do --apply).
export function relinkProblems({ product, oldPp, newPp, otherActiveLinks }) {
  const problems = [];
  if (!product) return ["Product amt-aluguel não encontrado"];
  if (product.id !== PRODUCT_ID) problems.push(`Product id=${product.id} (esperado ${PRODUCT_ID})`);
  if (product.status !== "PAUSED") problems.push(`Product status=${product.status} (esperado PAUSED)`);
  if (product._count.variants !== 0) problems.push(`Product tem ${product._count.variants} variante(s)`);

  if (!oldPp) problems.push(`ProviderProduct ${OLD_EXTERNAL_ID} não encontrado`);
  else {
    if (oldPp.id !== OLD_PP_ID) problems.push(`${OLD_EXTERNAL_ID}: id=${oldPp.id} (esperado ${OLD_PP_ID})`);
    if (oldPp.productId !== PRODUCT_ID) problems.push(`${OLD_EXTERNAL_ID}: productId=${oldPp.productId} (esperado ${PRODUCT_ID})`);
  }

  if (!newPp) problems.push(`ProviderProduct ${NEW_EXTERNAL_ID} não encontrado`);
  else {
    if (newPp.id !== NEW_PP_ID) problems.push(`${NEW_EXTERNAL_ID}: id=${newPp.id} (esperado ${NEW_PP_ID})`);
    if (!newPp.active) problems.push(`${NEW_EXTERNAL_ID}: active=false`);
    if (newPp.mode !== "REAL") problems.push(`${NEW_EXTERNAL_ID}: mode=${newPp.mode}`);
    if (newPp.productId !== null) problems.push(`${NEW_EXTERNAL_ID}: productId já preenchido (${newPp.productId})`);
    if (newPp._count.variants !== 0) problems.push(`${NEW_EXTERNAL_ID}: ligado a ${newPp._count.variants} variante(s)`);
  }

  if (otherActiveLinks.length)
    problems.push(`outros ProviderProducts ativos apontam para o produto: ${otherActiveLinks.map((pp) => pp.externalProductId).join(", ")}`);
  return problems;
}

const linkSnapshot = (pp) => ({ providerProductId: pp.id, externalProductId: pp.externalProductId, label: pp.label, providerCostCents: pp.providerCostCents, currency: pp.currency });

export function auditMetadata(oldPp, newPp) {
  return {
    script: "scripts/implement-amt-relink.mjs",
    productId: PRODUCT_ID,
    productSlug: PRODUCT_SLUG,
    before: { linked: linkSnapshot(oldPp), unlinked: linkSnapshot(newPp) },
    after: { linked: linkSnapshot(newPp), unlinked: linkSnapshot(oldPp) },
  };
}

// SQL de reversão: só desfaz os 2 vínculos (o AuditLog fica como histórico).
// Cada UPDATE só age se o estado ainda for o deixado por este script.
export function revertSql() {
  return [
    "BEGIN;",
    `UPDATE "ProviderProduct" SET "productId" = NULL, "updatedAt" = now()`,
    `  WHERE id = '${NEW_PP_ID}' AND "productId" = '${PRODUCT_ID}';  -- ${NEW_EXTERNAL_ID}`,
    `UPDATE "ProviderProduct" SET "productId" = '${PRODUCT_ID}', "updatedAt" = now()`,
    `  WHERE id = '${OLD_PP_ID}' AND "productId" IS NULL;  -- ${OLD_EXTERNAL_ID}`,
    "-- Confira: cada UPDATE deve afetar 1 linha. Senão, ROLLBACK;",
    "COMMIT;",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const line = (text = "") => console.log(text);
const yes = (ok) => (ok ? "OK" : "FALHOU");

const ppSelect = {
  id: true, externalProductId: true, label: true, productId: true, active: true, mode: true,
  providerCostCents: true, currency: true, technicalEligibility: true, automationClass: true,
  homologationStatus: true, expectedDeliveryType: true,
  provider: { select: { id: true, code: true, active: true } },
  _count: { select: { variants: true, orders: true, purchasedItems: true } },
};

async function loadContext(db) {
  const byExternal = (externalProductId) =>
    db.providerProduct.findFirst({ where: { externalProductId, provider: { code: PROVIDER_CODE } }, select: ppSelect });
  const [product, oldPp, newPp, otherActiveLinks, admins, settings] = await Promise.all([
    db.product.findUnique({
      where: { slug: PRODUCT_SLUG },
      select: {
        id: true, slug: true, status: true, available: true, priceCents: true, normalPriceCents: true,
        manualPriceCents: true, pricingMode: true, duration: true, deliveryEstimate: true,
        _count: { select: { variants: true, orderItems: true } },
      },
    }),
    byExternal(OLD_EXTERNAL_ID),
    byExternal(NEW_EXTERNAL_ID),
    db.providerProduct.findMany({
      where: { productId: PRODUCT_ID, active: true, id: { not: OLD_PP_ID } },
      select: { id: true, externalProductId: true },
    }),
    db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true, email: true } }),
    db.siteSettings.findUnique({ where: { id: "default" }, select: { providerMode: true } }),
  ]);
  return { product, oldPp, newPp, otherActiveLinks, admins, providerMode: settings?.providerMode ?? "TEST" };
}

const describePp = (pp) =>
  `${pp.externalProductId} "${pp.label}" productId=${pp.productId} active=${pp.active} mode=${pp.mode} ` +
  `custo=${pp.providerCostCents} ${pp.currency} ${pp.technicalEligibility}/${pp.automationClass}/${pp.homologationStatus} ` +
  `entrega=${pp.expectedDeliveryType} provider=${pp.provider.code}(ativo=${pp.provider.active}) ` +
  `variantes=${pp._count.variants} ProviderOrders=${pp._count.orders} itens=${pp._count.purchasedItems}`;

async function dryRun(db, argv) {
  const ctx = await loadContext(db);
  const { product, oldPp, newPp, providerMode } = ctx;
  let failed = false;
  const check = (label, ok, detail = "") => {
    if (!ok) failed = true;
    line(`  [${yes(ok)}] ${label}${detail ? ` — ${detail}` : ""}`);
  };

  line("MODE: DRY-RUN (somente SELECTs; nenhuma escrita)");
  line("\n=== (1) ESTADO ATUAL ===");
  if (product) {
    line(`  Product ${product.slug} id=${product.id} status=${product.status} available=${product.available}`);
    line(`    preço=${product.priceCents} normal=${product.normalPriceCents} manual=${product.manualPriceCents} pricingMode=${product.pricingMode}`);
    line(`    duração=${JSON.stringify(product.duration)} prazo=${JSON.stringify(product.deliveryEstimate)} variantes=${product._count.variants} itens de pedido=${product._count.orderItems}`);
  }
  if (oldPp) line(`  antigo: ${describePp(oldPp)}`);
  if (newPp) line(`  novo:   ${describePp(newPp)}`);

  line("\n=== (2) ESCRITAS QUE O --apply FARIA (1 transação) ===");
  line(`  UPDATE ProviderProduct ${OLD_PP_ID} (${OLD_EXTERNAL_ID}): productId ${PRODUCT_ID} -> null`);
  line(`  UPDATE ProviderProduct ${NEW_PP_ID} (${NEW_EXTERNAL_ID}): productId null -> ${PRODUCT_ID}`);
  if (oldPp && newPp) line(`  INSERT AuditLog action=${AUDIT_ACTION} entity=Product/${PRODUCT_ID} metadata=${JSON.stringify(auditMetadata(oldPp, newPp))}`);
  line("  Nada mais: status, preço, prazo e duração do Product não mudam; pedidos e ProviderOrders não são tocados.");

  line("\n=== (3) VERIFICAÇÕES ===");
  const problems = relinkProblems(ctx);
  check("pré-condições", problems.length === 0, problems.join("; ") || "produto PAUSED sem variantes; 2337 aponta para ele; 2216 ativo, REAL, livre, sem variantes; nenhum outro vínculo ativo");
  const picked = pickActor(ctx.admins, actorArg(argv));
  check("ator do AuditLog", Boolean(picked.actor), picked.problem ?? picked.actor.email);
  if (newPp) {
    const result = resolveProviderProduct([{ ...newPp, productId: PRODUCT_ID }], providerMode);
    check(`resolveProviderProduct(depois) = SELECTED ${NEW_EXTERNAL_ID} (providerMode=${providerMode})`, result.status === "SELECTED" && result.providerProduct.id === newPp.id, `status=${result.status}`);
  }

  line("\n=== (4) COMO REVERTER ===");
  line("Antes de --apply nada existe para reverter (dry-run não escreve). Depois de --apply, execute no SQL editor:");
  line(revertSql());

  line(`\nRESULTADO: ${failed ? "HÁ VERIFICAÇÕES FALHAS — --apply seria recusado." : "todas as verificações OK — --apply seria aceito."}`);
  if (failed) process.exitCode = 2;
}

async function apply(db, argv) {
  line("MODE: APPLY (1 transação)");
  const summary = await db.$transaction(
    async (tx) => {
      const ctx = await loadContext(tx);
      const problems = relinkProblems(ctx);
      if (problems.length) throw new Error(`ABORTADO: ${problems.join("; ")}`);
      const picked = pickActor(ctx.admins, actorArg(argv));
      if (!picked.actor) throw new Error(`ABORTADO: ${picked.problem}`);
      const { product, oldPp, newPp, providerMode } = ctx;
      const [orderItemsBefore, providerOrdersBefore] = await Promise.all([tx.orderItem.count(), tx.providerOrder.count()]);

      // Escrita (claims condicionados ao estado lido)
      const unlinked = await tx.providerProduct.updateMany({ where: { id: OLD_PP_ID, productId: PRODUCT_ID }, data: { productId: null } });
      if (unlinked.count !== 1) throw new Error(`ABORTADO: desvínculo do ${OLD_EXTERNAL_ID} não aplicado (concorrência?)`);
      const linked = await tx.providerProduct.updateMany({ where: { id: NEW_PP_ID, productId: null }, data: { productId: PRODUCT_ID } });
      if (linked.count !== 1) throw new Error(`ABORTADO: vínculo do ${NEW_EXTERNAL_ID} não aplicado (concorrência?)`);
      await tx.auditLog.create({
        data: { actorUserId: picked.actor.id, action: AUDIT_ACTION, entityType: "Product", entityId: PRODUCT_ID, metadata: auditMetadata(oldPp, newPp) },
      });

      // Pós-checagens
      const after = await tx.product.findUniqueOrThrow({
        where: { id: PRODUCT_ID },
        select: {
          status: true, available: true, priceCents: true, normalPriceCents: true, manualPriceCents: true,
          _count: { select: { variants: true } },
          providerProducts: { select: { id: true, productId: true, externalProductId: true, active: true, mode: true, providerCostCents: true, technicalEligibility: true, provider: { select: { id: true, code: true, active: true } } } },
        },
      });
      if (after.status !== product.status || after.available !== product.available || after.priceCents !== product.priceCents || after.normalPriceCents !== product.normalPriceCents || after.manualPriceCents !== product.manualPriceCents || after._count.variants !== 0)
        throw new Error("ABORTADO: o Product mudou além do vínculo");
      if (after.providerProducts.length !== 1 || after.providerProducts[0].id !== NEW_PP_ID)
        throw new Error(`ABORTADO: vínculos finais = ${after.providerProducts.map((pp) => pp.externalProductId).join(", ")}`);
      const resolution = resolveProviderProduct(after.providerProducts, providerMode);
      if (resolution.status !== "SELECTED" || resolution.providerProduct.id !== NEW_PP_ID)
        throw new Error(`ABORTADO: resolveProviderProduct = ${resolution.status}`);
      const [orderItemsAfter, providerOrdersAfter] = await Promise.all([tx.orderItem.count(), tx.providerOrder.count()]);
      if (orderItemsAfter !== orderItemsBefore || providerOrdersAfter !== providerOrdersBefore)
        throw new Error("ABORTADO: contagem de OrderItem/ProviderOrder mudou");
      return { actor: picked.actor.email };
    },
    { timeout: 30_000 },
  );
  line(`RELIGADO ${PRODUCT_SLUG}: ${OLD_EXTERNAL_ID} (${OLD_PP_ID}) -> ${NEW_EXTERNAL_ID} (${NEW_PP_ID}); AuditLog ${AUDIT_ACTION} por ${summary.actor}`);
  line("\nPara reverter:");
  line(revertSql());
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = resolveMode(argv, process.env);
  const db = new PrismaClient();
  try {
    if (mode === "APPLY") await apply(db, argv);
    else await dryRun(db, argv);
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
