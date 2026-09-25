import { describe, expect, it, vi } from "vitest";
import { handleResellerTicketRequest, isDefinitiveAdcleanFailure, RESELLER_RATE_LIMIT } from "./reseller-api";
import { hashResellerApiKey } from "./reseller-keys";
import { AdcleanProviderError } from "./providers/adclean";
import {
  ProviderNotConnectedError,
  ProviderOrderUncertainError,
  type ProviderAdapter,
  type ProviderOrderResult,
} from "./providers/types";
import { createFakeLedgerDb, type FakeState } from "./testing/fake-ledger-db";

const KEY = "bsr_chave-de-teste-do-revendedor";
const completed = (code: string): ProviderOrderResult => ({
  status: "COMPLETED",
  externalOrderId: "k",
  delivery: { credential: code, deliveryType: "CODE" },
});

function setup(options: {
  state?: Partial<FakeState>;
  createOrder?: ProviderAdapter["createOrder"];
  getOrderStatus?: ProviderAdapter["getOrderStatus"];
  configured?: boolean;
} = {}) {
  const db = createFakeLedgerDb({
    users: [{ id: "reseller", role: "RESELLER", active: true, passwordHash: "hash" }],
    keys: [
      {
        id: "key-1",
        userId: "reseller",
        tokenHash: hashResellerApiKey(KEY),
        label: null,
        active: true,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
      },
    ],
    balances: [{ id: "bal-1", userId: "reseller", balanceCents: 5000, enabled: true }],
    resellerPriceCents: 1500,
    ...options.state,
  });
  const adapter = {
    code: "adclean",
    supportsReconciliation: true,
    checkConnection: vi.fn(),
    listProducts: vi.fn(),
    getBalance: vi.fn(),
    createOrder: vi.fn(options.createOrder ?? (async () => completed("TICKET-123"))),
    getOrderStatus: vi.fn(options.getOrderStatus ?? (async () => completed("TICKET-123"))),
    buildReconciliationIdentity: (orderId: string) => `bancadasoft:${orderId}`,
  } satisfies ProviderAdapter;
  const log = vi.fn();
  const call = (body: unknown = { external_reference: "pedido-1" }, authorization: string | null = `Bearer ${KEY}`) =>
    handleResellerTicketRequest(
      new Request("https://test/api/reseller/v1/tickets", {
        method: "POST",
        headers: authorization ? { authorization, "content-type": "application/json" } : { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { db: db as never, adapter: () => adapter, configured: () => options.configured ?? true, log },
    );
  return { db, adapter, log, call };
}

const balanceOf = (db: ReturnType<typeof createFakeLedgerDb>) => db.state.balances[0].balanceCents;

describe("API de revenda — autenticação e autorização", () => {
  it("401 sem Authorization, com formato inválido ou com chave desconhecida", async () => {
    const { call, adapter } = setup();
    for (const header of [null, KEY, "Bearer ", "Bearer bsr_outra-chave", "Basic abc"]) {
      const response = await call(undefined, header);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "INVALID_API_KEY" });
    }
    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it("401 para chave revogada ou inativa", async () => {
    for (const patch of [{ revokedAt: new Date() }, { active: false }]) {
      const { call, db } = setup();
      Object.assign(db.state.keys[0], patch);
      expect((await call()).status).toBe(401);
      expect(db.state.entries).toHaveLength(0);
    }
  });

  it("403 quando a conta não é RESELLER ou o saldo não está habilitado", async () => {
    const notReseller = setup({ state: { users: [{ id: "reseller", role: "USER", active: true, passwordHash: "hash" }] } });
    expect(await (await notReseller.call()).json()).toMatchObject({ code: "RESELLER_ROLE_REQUIRED" });
    const disabled = setup({ state: { balances: [{ id: "bal-1", userId: "reseller", balanceCents: 5000, enabled: false }] } });
    const response = await disabled.call();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "BALANCE_NOT_ENABLED" });
    expect(disabled.db.state.entries).toHaveLength(0);
  });

  it("registra lastUsedAt da chave usada", async () => {
    const { call, db } = setup();
    await call();
    expect(db.state.keys[0].lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("API de revenda — validações antes de debitar", () => {
  it("400 sem external_reference ou com caracteres fora do formato (inclusive ':')", async () => {
    const { call, db } = setup();
    for (const body of [{}, { external_reference: "" }, { external_reference: "refund:x" }, { external_reference: "a".repeat(101) }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(db.state.entries).toHaveLength(0);
  });

  it("503 quando a revenda AdClean não está configurada, sem debitar", async () => {
    const { call, db, adapter } = setup({ configured: false });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "RESELLER_INTEGRATION_NOT_CONFIGURED" });
    expect(db.state.entries).toHaveLength(0);
    expect(balanceOf(db)).toBe(5000);
    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it("409 quando o produto não tem resellerPriceCents (não vendido a revendedor)", async () => {
    const { call, db } = setup({ state: { resellerPriceCents: null } });
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PRODUCT_NOT_AVAILABLE_FOR_RESALE" });
    expect(db.state.entries).toHaveLength(0);
  });

  it("402 com saldo insuficiente, sem debitar e sem chamar o AdClean", async () => {
    const { call, db, adapter } = setup({ state: { balances: [{ id: "bal-1", userId: "reseller", balanceCents: 1000, enabled: true }] } });
    const response = await call();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(db.state.entries).toHaveLength(0);
    expect(balanceOf(db)).toBe(1000);
    expect(adapter.createOrder).not.toHaveBeenCalled();
  });

  it(`429 depois de ${RESELLER_RATE_LIMIT.maxPurchases} compras na janela, sem debitar`, async () => {
    const { call, db, adapter } = setup({ state: { balances: [{ id: "bal-1", userId: "reseller", balanceCents: 100_000, enabled: true }] } });
    for (let index = 0; index < RESELLER_RATE_LIMIT.maxPurchases; index++)
      expect((await call({ external_reference: `pedido-${index}` })).status).toBe(200);
    const limited = await call({ external_reference: "pedido-extra" });
    expect(limited.status).toBe(429);
    expect(db.state.entries).toHaveLength(RESELLER_RATE_LIMIT.maxPurchases);
    expect(adapter.createOrder).toHaveBeenCalledTimes(RESELLER_RATE_LIMIT.maxPurchases);
  });
});

describe("API de revenda — débito, emissão e idempotência", () => {
  it("sucesso: debita o resellerPriceCents, chama o AdClean depois do débito e devolve o código", async () => {
    const { call, db, adapter } = setup();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "COMPLETED",
      replay: false,
      external_reference: "pedido-1",
      ticket: { code: "TICKET-123", duration_hours: 168 },
      charged_cents: 1500,
      balance_cents: 3500,
    });
    const [entry] = db.state.entries;
    expect(entry).toMatchObject({ type: "PURCHASE", amountCents: -1500, externalReference: "pedido-1" });
    expect(adapter.createOrder).toHaveBeenCalledWith({
      providerProductId: "ticket-168h",
      reference: entry.id,
      payload: { orderId: `revenda-${entry.id}`, paidAmountCents: 1500 },
    });
  });

  it("replay da mesma external_reference: não debita de novo e só consulta o AdClean (nunca gera)", async () => {
    const { call, db, adapter } = setup();
    await call();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replay: true, ticket: { code: "TICKET-123" }, balance_cents: 3500 });
    expect(db.state.entries).toHaveLength(1);
    expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    expect(adapter.getOrderStatus).toHaveBeenCalledWith(`bancadasoft:revenda-${db.state.entries[0].id}`);
  });

  it("replay em que o AdClean não conhece a chave: pede a geração com a MESMA chave, sem novo débito", async () => {
    const { call, db, adapter } = setup({
      createOrder: vi.fn().mockRejectedValueOnce(new ProviderOrderUncertainError()).mockResolvedValue(completed("TICKET-9")),
      getOrderStatus: async () => ({ status: "FAILED", error: "ADCLEAN_TICKET_NOT_FOUND" }),
    });
    expect((await call()).status).toBe(202);
    const response = await call();
    expect(await response.json()).toMatchObject({ status: "COMPLETED", replay: true, ticket: { code: "TICKET-9" } });
    expect(db.state.entries).toHaveLength(1);
    const orderIds = adapter.createOrder.mock.calls.map(([input]) => input.payload.orderId);
    expect(new Set(orderIds).size).toBe(1);
  });

  it("falha definitiva do AdClean: estorna (REFUND) e devolve erro claro", async () => {
    const { call, db } = setup({ createOrder: async () => { throw new AdcleanProviderError("ADCLEAN_NOT_AUTHORIZED"); } });
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "TICKET_FAILED_REFUNDED", refunded: true });
    expect(db.state.entries.map((e) => [e.type, e.amountCents])).toEqual([["PURCHASE", -1500], ["REFUND", 1500]]);
    expect(balanceOf(db)).toBe(5000);
  });

  it("replay depois de um estorno devolve a falha anterior sem chamar o AdClean nem debitar", async () => {
    const { call, db, adapter } = setup({ createOrder: async () => { throw new AdcleanProviderError("ADCLEAN_HTTP_403"); } });
    await call();
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ replay: true, refunded: true });
    expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    expect(adapter.getOrderStatus).not.toHaveBeenCalled();
    expect(db.state.entries).toHaveLength(2);
  });

  it("resultado incerto (timeout/5xx): não estorna e devolve 202 PROCESSING", async () => {
    const { call, db } = setup({ createOrder: async () => { throw new ProviderOrderUncertainError(); } });
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "PROCESSING", charged_cents: 1500 });
    expect(db.state.entries.map((e) => e.type)).toEqual(["PURCHASE"]);
    expect(balanceOf(db)).toBe(3500);
  });

  it("classifica como definitivas só as falhas em que o ticket comprovadamente não foi gerado", () => {
    expect(isDefinitiveAdcleanFailure(new AdcleanProviderError("ADCLEAN_NOT_AUTHORIZED"))).toBe(true);
    expect(isDefinitiveAdcleanFailure(new AdcleanProviderError("ADCLEAN_HTTP_404"))).toBe(true);
    expect(isDefinitiveAdcleanFailure(new ProviderNotConnectedError("adclean"))).toBe(true);
    expect(isDefinitiveAdcleanFailure(new AdcleanProviderError("ADCLEAN_INVALID_RESPONSE"))).toBe(false);
    expect(isDefinitiveAdcleanFailure(new ProviderOrderUncertainError())).toBe(false);
    expect(isDefinitiveAdcleanFailure(new Error("boom"))).toBe(false);
  });

  it("nunca expõe a chave em resposta nem em log", async () => {
    const { call, log } = setup({ createOrder: async () => { throw new AdcleanProviderError("ADCLEAN_NOT_AUTHORIZED"); } });
    const body = JSON.stringify(await (await call()).json());
    expect(body).not.toContain(KEY);
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
    expect(log).toHaveBeenCalled();
  });
});
