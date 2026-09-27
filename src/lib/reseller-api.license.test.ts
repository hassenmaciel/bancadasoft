import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  adcleanLicenseResellerFulfiller,
  handleResellerTicketRequest,
  isDefinitiveAdcleanLicenseFailure,
  parseResellerNote,
  resellerNote,
} from "./reseller-api";
import { hashResellerApiKey } from "./reseller-keys";
import { AdcleanLicenseAdapter, AdcleanLicenseError, type OrderLookup } from "./providers/adclean-license";
import { ProviderNotConnectedError, type ProviderAdapter, type ProviderOrderResult } from "./providers/types";
import { createFakeLedgerDb, type FakeCatalogItem, type FakeState } from "./testing/fake-ledger-db";

const KEY = "bsr_chave-de-teste-do-revendedor";
const TOKEN = "test-license-token-not-a-real-secret";

// Um Product por período (adclean-licenca-12h / -6-meses / -1-ano), cada um
// com o próprio resellerPriceCents.
const licenseItem = (overrides: Partial<FakeCatalogItem> = {}): FakeCatalogItem => ({
  slug: "adclean-licenca-1-ano",
  resellerPriceCents: 2500,
  providerCode: "adclean-license",
  externalProductId: "licenca-8760h",
  metadata: { periodo_horas: 8760 },
  active: true,
  ...overrides,
});
const license12h = licenseItem({
  slug: "adclean-licenca-12h",
  resellerPriceCents: 400,
  externalProductId: "licenca-12h",
  metadata: { periodo_horas: 12 },
});
const ticketItem: FakeCatalogItem = {
  slug: "adclean-ticket",
  resellerPriceCents: 1500,
  providerCode: "adclean",
  externalProductId: "ticket-168h",
  metadata: null,
  active: true,
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const generated = (codigo = "LIC-0001") =>
  reply(200, { ok: true, codigo, email: "cliente@example.com", periodo_horas: 8760 });
const LICENSE_BODY = { external_reference: "pedido-1", product: "adclean-licenca-1-ano", email: " Cliente@Example.com " };

function setup(options: {
  state?: Partial<FakeState>;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  licenseConfigured?: boolean;
  withLicense?: boolean;
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
    catalog: [licenseItem(), license12h, ticketItem],
    ...options.state,
  });
  const fetcher = vi.fn(options.fetcher ?? (async () => generated()));
  const loadOrders: OrderLookup[] = [];
  const ticketAdapter = {
    code: "adclean",
    supportsReconciliation: true,
    checkConnection: vi.fn(),
    listProducts: vi.fn(),
    getBalance: vi.fn(),
    createOrder: vi.fn(async (): Promise<ProviderOrderResult> => ({
      status: "COMPLETED",
      externalOrderId: "k",
      delivery: { credential: "TICKET-123", deliveryType: "CODE" },
    })),
    getOrderStatus: vi.fn(),
  } satisfies ProviderAdapter;
  const fulfillers =
    options.withLicense === false
      ? undefined
      : {
          "adclean-license": adcleanLicenseResellerFulfiller({
            configured: () => options.licenseConfigured ?? true,
            adapter: (loadOrder) => {
              loadOrders.push(loadOrder);
              return new AdcleanLicenseAdapter({ token: TOKEN, fetcher, loadOrder });
            },
          }),
        };
  const call = (body: unknown = LICENSE_BODY) =>
    handleResellerTicketRequest(
      new Request("https://test/api/reseller/v1/tickets", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { db: db as never, adapter: () => ticketAdapter, configured: () => true, fulfillers, log: vi.fn() },
    );
  return { db, fetcher, ticketAdapter, loadOrders, call };
}

const balanceOf = (db: ReturnType<typeof createFakeLedgerDb>) => db.state.balances[0].balanceCents;
const sentBody = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

describe("API de revenda — licença AdClean", () => {
  it("sucesso: debita o resellerPriceCents, gera no AdClean com o e-mail do cliente final e devolve a licença", async () => {
    const { call, db, fetcher, ticketAdapter } = setup();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: "COMPLETED",
      replay: false,
      external_reference: "pedido-1",
      license: { code: "LIC-0001", email: "cliente@example.com", period_hours: 8760 },
      charged_cents: 2500,
      balance_cents: 2500,
    });
    const [entry] = db.state.entries;
    expect(entry).toMatchObject({
      type: "PURCHASE",
      amountCents: -2500,
      externalReference: "pedido-1",
      note: "Revenda adclean-license licenca-8760h cliente@example.com",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toMatch(/\/admin\/gerar$/);
    expect(sentBody(fetcher.mock.calls[0])).toEqual({
      token: TOKEN,
      periodo_horas: 8760,
      email: "cliente@example.com",
      idempotency_key: `bancadasoft-licenca:revenda-${entry.id}`,
      external_order_id: `revenda-${entry.id}`,
    });
    expect(ticketAdapter.createOrder).not.toHaveBeenCalled();
  });

  it("cada período é um Product com preço próprio; o período vem do ProviderProduct, nunca do corpo", async () => {
    const { call, fetcher, db } = setup();
    const response = await call({ ...LICENSE_BODY, product: "adclean-licenca-12h", periodo_horas: 8760 });
    expect(await response.json()).toMatchObject({ charged_cents: 400, balance_cents: 4600 });
    expect(sentBody(fetcher.mock.calls[0])).toMatchObject({ periodo_horas: 12 });
    expect(db.state.entries[0].note).toBe("Revenda adclean-license licenca-12h cliente@example.com");
  });

  it("400 INVALID_EMAIL sem e-mail ou com e-mail inválido, sem debitar nem chamar o AdClean", async () => {
    const { call, db, fetcher } = setup();
    for (const email of [undefined, "", "   ", "sem-arroba", "a@", "@b.com", "a b@c.com", 42, `${"a".repeat(250)}@x.com`]) {
      const response = await call({ ...LICENSE_BODY, email });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL" });
    }
    expect(db.state.entries).toHaveLength(0);
    expect(balanceOf(db)).toBe(5000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("409 quando o produto da licença não tem resellerPriceCents, sem debitar", async () => {
    const { call, db, fetcher } = setup({ state: { catalog: [licenseItem({ resellerPriceCents: null })] } });
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "PRODUCT_NOT_AVAILABLE_FOR_RESALE" });
    expect(db.state.entries).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("402 com saldo insuficiente, sem debitar e sem chamar o AdClean", async () => {
    const { call, db, fetcher } = setup({
      state: { balances: [{ id: "bal-1", userId: "reseller", balanceCents: 2499, enabled: true }] },
    });
    const response = await call();
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(db.state.entries).toHaveLength(0);
    expect(balanceOf(db)).toBe(2499);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("503 quando a licença não está configurada, sem debitar", async () => {
    const { call, db, fetcher } = setup({ licenseConfigured: false });
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "RESELLER_INTEGRATION_NOT_CONFIGURED" });
    expect(db.state.entries).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("400 INVALID_PRODUCT para produto desconhecido (inclusive a ficha antiga), vínculo inativo ou ambíguo", async () => {
    const { call, db } = setup({
      state: {
        catalog: [
          licenseItem({ slug: "adclean-licenca-6-meses", externalProductId: "licenca-4320h", active: false }),
          licenseItem({ slug: "duplicado", externalProductId: "licenca-a" }),
          licenseItem({ slug: "duplicado", externalProductId: "licenca-b" }),
        ],
      },
    });
    for (const body of [
      { ...LICENSE_BODY, product: "nao-existe" },
      { ...LICENSE_BODY, product: "adclean-licenca" },
      { ...LICENSE_BODY, product: "adclean-licenca-6-meses" },
      { ...LICENSE_BODY, product: "duplicado" },
    ]) {
      const response = await call(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_PRODUCT" });
    }
    expect((await call({ ...LICENSE_BODY, product: "com espaço" })).status).toBe(400);
    expect(db.state.entries).toHaveLength(0);
  });

  it("replay da mesma external_reference: não debita de novo e reconcilia com a MESMA chave e o MESMO e-mail", async () => {
    const { call, db, fetcher } = setup();
    await call();
    // O reenvio vale pela compra original, mesmo com outro e-mail/produto no corpo.
    const response = await call({ ...LICENSE_BODY, product: "adclean-licenca-12h", email: "outro@example.com" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replay: true, license: { code: "LIC-0001" }, balance_cents: 2500 });
    expect(db.state.entries).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sentBody(fetcher.mock.calls[1])).toEqual(sentBody(fetcher.mock.calls[0]));
  });

  it("falha definitiva (401 do AdClean): estorna e devolve LICENSE_FAILED_REFUNDED; replay devolve a falha sem chamar de novo", async () => {
    const { call, db, fetcher } = setup({ fetcher: async () => reply(401, { ok: false, erro: "nao_autorizado" }) });
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "LICENSE_FAILED_REFUNDED", refunded: true });
    expect(db.state.entries.map((e) => [e.type, e.amountCents])).toEqual([["PURCHASE", -2500], ["REFUND", 2500]]);
    expect(balanceOf(db)).toBe(5000);
    const again = await call();
    expect(await again.json()).toMatchObject({ replay: true, code: "LICENSE_FAILED_REFUNDED" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("resultado incerto (5xx duas vezes): não estorna e devolve 202 PROCESSING", async () => {
    const { call, db } = setup({ fetcher: async () => reply(503, {}) });
    const response = await call();
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "PROCESSING", charged_cents: 2500 });
    expect(db.state.entries.map((e) => e.type)).toEqual(["PURCHASE"]);
    expect(balanceOf(db)).toBe(2500);
  });

  it("o lookup injetado só responde pelo próprio pedido da revenda", async () => {
    const { call, loadOrders } = setup();
    await call();
    expect(await loadOrders[0]("outro-pedido")).toBeNull();
  });
});

describe("API de revenda — roteamento por produto", () => {
  it("product do ticket roteia para o adapter do ticket, sem exigir e-mail", async () => {
    const { call, fetcher, ticketAdapter, db } = setup();
    const response = await call({ external_reference: "pedido-t", product: "adclean-ticket" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ticket: { code: "TICKET-123" }, charged_cents: 1500 });
    expect(ticketAdapter.createOrder).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(db.state.entries[0].note).toBe("Revenda AdClean ticket-168h");
  });

  it("sem product continua sendo o ticket e ignora um campo email qualquer, como antes", async () => {
    const { call, fetcher, ticketAdapter } = setup();
    const response = await call({ external_reference: "pedido-t", email: "não é e-mail" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ticket: { code: "TICKET-123" } });
    expect(ticketAdapter.createOrder).toHaveBeenCalledWith(expect.objectContaining({ providerProductId: "ticket-168h" }));
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("provider sem fulfiller registrado -> INVALID_PRODUCT, sem debitar", async () => {
    const { call, db } = setup({ withLicense: false });
    const response = await call();
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PRODUCT" });
    expect(db.state.entries).toHaveLength(0);
  });

  it("400 INVALID_BODY quando product não é um identificador", async () => {
    const { call } = setup();
    for (const body of [{ ...LICENSE_BODY, product: 1 }, { ...LICENSE_BODY, product: ["adclean-licenca-1-ano"] }, { ...LICENSE_BODY, product: "" }])
      expect(await (await call(body)).json()).toMatchObject({ code: "INVALID_BODY" });
  });
});

describe("API de revenda — note do lançamento e classificação de falhas", () => {
  it("lê notes antigos e novos; ausente/ilegível é ticket", () => {
    const ticket = { providerCode: "adclean", externalProductId: "ticket-168h", email: null };
    expect(parseResellerNote("Revenda AdClean ticket-168h")).toEqual(ticket);
    expect(parseResellerNote(null)).toEqual(ticket);
    expect(parseResellerNote("qualquer coisa")).toEqual(ticket);
    const license = { providerCode: "adclean-license", externalProductId: "licenca-12h", email: "a@b.com" };
    expect(parseResellerNote(resellerNote(license))).toEqual(license);
    expect(resellerNote(ticket)).toBe("Revenda AdClean ticket-168h");
  });

  it("licença: definitivas só quando o código comprovadamente não foi gerado", () => {
    for (const code of ["ADCLEAN_LICENSE_NOT_AUTHORIZED", "ADCLEAN_LICENSE_EMAIL_INVALID", "ADCLEAN_LICENSE_PERIOD_INVALID", "ADCLEAN_LICENSE_HTTP_404"])
      expect(isDefinitiveAdcleanLicenseFailure(new AdcleanLicenseError(code))).toBe(true);
    expect(isDefinitiveAdcleanLicenseFailure(new ProviderNotConnectedError("adclean-license"))).toBe(true);
    for (const code of ["ADCLEAN_LICENSE_INVALID_RESPONSE", "ADCLEAN_LICENSE_HTTP_200", "ADCLEAN_LICENSE_HTTP_302"])
      expect(isDefinitiveAdcleanLicenseFailure(new AdcleanLicenseError(code))).toBe(false);
    expect(isDefinitiveAdcleanLicenseFailure(new Error("boom"))).toBe(false);
  });
});
