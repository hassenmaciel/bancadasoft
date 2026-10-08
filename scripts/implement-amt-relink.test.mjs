import { describe, expect, it } from "vitest";
import { resolveProviderProduct } from "../src/lib/providers/selection";
import {
  actorArg,
  auditMetadata,
  CONFIRM_ENV,
  NEW_PP_ID,
  OLD_PP_ID,
  pickActor,
  PRODUCT_ID,
  relinkProblems,
  resolveMode,
  revertSql,
} from "./implement-amt-relink.mjs";

const provider = { id: "prov-1", code: "heartunlocks", active: true };
const pp = (overrides = {}) => ({
  label: "x",
  active: true,
  mode: "REAL",
  providerCostCents: 30,
  currency: "USD",
  technicalEligibility: "READY",
  provider,
  _count: { variants: 0, orders: 0, purchasedItems: 0 },
  ...overrides,
});
const ctx = (overrides = {}) => ({
  product: { id: PRODUCT_ID, status: "PAUSED", _count: { variants: 0, orderItems: 2 } },
  oldPp: pp({ id: OLD_PP_ID, externalProductId: "2337", productId: PRODUCT_ID, providerCostCents: 35 }),
  newPp: pp({ id: NEW_PP_ID, externalProductId: "2216", productId: null }),
  otherActiveLinks: [],
  ...overrides,
});

describe("resolveMode", () => {
  it("padrão é DRY_RUN, mesmo com a variável de confirmação", () => {
    expect(resolveMode([], {})).toBe("DRY_RUN");
    expect(resolveMode([], { [CONFIRM_ENV]: "SIM" })).toBe("DRY_RUN");
  });
  it("--apply sem confirmação é recusado", () => {
    expect(() => resolveMode(["--apply"], {})).toThrow(CONFIRM_ENV);
    expect(() => resolveMode(["--apply"], { [CONFIRM_ENV]: "sim" })).toThrow();
  });
  it("--apply com confirmação → APPLY", () => {
    expect(resolveMode(["--apply"], { [CONFIRM_ENV]: "SIM" })).toBe("APPLY");
  });
});

describe("relinkProblems — pré-condições", () => {
  it("estado atual esperado não tem problemas", () => {
    expect(relinkProblems(ctx())).toEqual([]);
  });

  it.each([
    ["produto inexistente", { product: null }, "não encontrado"],
    ["produto com outro id", { product: { id: "outro", status: "PAUSED", _count: { variants: 0 } } }, "Product id=outro"],
    ["produto PUBLISHED", { product: { id: PRODUCT_ID, status: "PUBLISHED", _count: { variants: 0 } } }, "status=PUBLISHED"],
    ["produto com variante", { product: { id: PRODUCT_ID, status: "PAUSED", _count: { variants: 1 } } }, "variante"],
    ["2337 inexistente", { oldPp: null }, "2337 não encontrado"],
    ["2337 não aponta para o produto", { oldPp: pp({ id: OLD_PP_ID, externalProductId: "2337", productId: null }) }, "2337: productId=null"],
    ["2216 inexistente", { newPp: null }, "2216 não encontrado"],
    ["2216 com outro id", { newPp: pp({ id: "outro", externalProductId: "2216", productId: null }) }, "2216: id=outro"],
    ["2216 inativo", { newPp: pp({ id: NEW_PP_ID, externalProductId: "2216", productId: null, active: false }) }, "active=false"],
    ["2216 em TEST", { newPp: pp({ id: NEW_PP_ID, externalProductId: "2216", productId: null, mode: "TEST" }) }, "mode=TEST"],
    ["2216 já ligado", { newPp: pp({ id: NEW_PP_ID, externalProductId: "2216", productId: "outro-produto" }) }, "já preenchido"],
    ["2216 com variante", { newPp: pp({ id: NEW_PP_ID, externalProductId: "2216", productId: null, _count: { variants: 1 } }) }, "variante"],
    ["outro vínculo ativo", { otherActiveLinks: [{ id: "pp-x", externalProductId: "2995" }] }, "2995"],
  ])("%s → aborta", (_, patch, fragment) => {
    const problems = relinkProblems(ctx(patch));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("; ")).toContain(fragment);
  });
});

describe("ator do AuditLog", () => {
  const admins = [{ id: "u1", email: "a@x.com" }, { id: "u2", email: "b@x.com" }];
  it("lê --actor=", () => {
    expect(actorArg(["--apply", "--actor= B@X.com "])).toBe("b@x.com");
    expect(actorArg(["--apply"])).toBeNull();
  });
  it("1 ADMIN sem --actor → ele; vários sem --actor → problema", () => {
    expect(pickActor([admins[0]], null)).toEqual({ actor: admins[0] });
    expect(pickActor(admins, null).problem).toContain("--actor");
  });
  it("--actor precisa ser um ADMIN ativo", () => {
    expect(pickActor(admins, "b@x.com")).toEqual({ actor: admins[1] });
    expect(pickActor(admins, "c@x.com").problem).toContain("não é um ADMIN");
  });
});

describe("resultado do vínculo", () => {
  it("só o 2216 ligado resolve SELECTED; os dois ligados seria AMBIGUOUS", () => {
    const { oldPp, newPp } = ctx();
    const linkedNew = { ...newPp, productId: PRODUCT_ID };
    expect(resolveProviderProduct([linkedNew], "REAL")).toMatchObject({ status: "SELECTED", providerProduct: { id: NEW_PP_ID } });
    expect(resolveProviderProduct([oldPp, linkedNew], "REAL").status).toBe("AMBIGUOUS");
  });

  it("auditMetadata registra antes/depois", () => {
    const { oldPp, newPp } = ctx();
    const meta = auditMetadata(oldPp, newPp);
    expect(meta.before.linked).toMatchObject({ providerProductId: OLD_PP_ID, externalProductId: "2337", providerCostCents: 35 });
    expect(meta.after.linked).toMatchObject({ providerProductId: NEW_PP_ID, externalProductId: "2216", providerCostCents: 30 });
    expect(meta.productId).toBe(PRODUCT_ID);
  });

  it("revertSql só desfaz os 2 vínculos, condicionado ao estado deixado pelo script", () => {
    const sql = revertSql();
    expect(sql).toContain(`WHERE id = '${NEW_PP_ID}' AND "productId" = '${PRODUCT_ID}'`);
    expect(sql).toContain(`SET "productId" = '${PRODUCT_ID}'`);
    expect(sql).toContain(`WHERE id = '${OLD_PP_ID}' AND "productId" IS NULL`);
    expect(sql).not.toMatch(/DELETE|"Order"|"OrderItem"|"ProviderOrder"|"Product" SET/);
  });
});
