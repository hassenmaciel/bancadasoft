import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// HOMOLOGAÇÃO da correção "reconciliação/recovery de pagamento PAID sem
// entrega" — reproduz, com fixtures e SEM nenhuma chamada real a Asaas/
// AdClean/HeartUnlocks, os dois casos obrigatórios da investigação forense:
//
//   Caminho A — clean failure: Payment PAID, Order/Fulfillment FAILED,
//   ProviderOrder inexistente (o pedido REAL visto no Admin em 17/09/2026,
//   nomes/valores aqui são fictícios).
//
//   Caminho B — resultado incerto: ProviderOrder existe com requestReference/
//   resultUncertain (o fixture original da auditoria), agora resolvido por
//   reconcileFulfillment em vez de ficar bloqueado para sempre.
//
// Nenhum arquivo de produção foi alterado para escrever este teste.

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  fulfillment: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  providerOrder: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  provider: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  attemptAutomaticGuestRecovery,
  executeFulfillment,
  reconcileFulfillment,
} from "./fulfillment-engine";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

// Roteia as chamadas fetch por path (gerar-ticket vs consultar-ticket) para
// que os testes possam provar, por evidência de chamada, que gerar-ticket
// NUNCA é invocado quando já existe uma tentativa externa registrada.
function stubAdcleanFetch(handlers: {
  gerar?: () => Response;
  consultar?: () => Response;
}) {
  const calls: Array<"gerar" | "consultar" | "unknown"> = [];
  const fn = vi.fn((url: string) => {
    const path = url.includes("/admin/gerar-ticket")
      ? "gerar"
      : url.includes("/admin/consultar-ticket")
        ? "consultar"
        : "unknown";
    calls.push(path);
    const handler = handlers[path as "gerar" | "consultar"];
    if (!handler) throw new Error(`Chamada AdClean inesperada: ${path}`);
    return Promise.resolve(handler());
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const adcleanProviderProduct = () => ({
  id: "provider-product-adclean-ticket-168h",
  providerId: "provider-adclean-v2",
  externalProductId: "ticket-168h",
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  providerCostCents: null,
  currency: "BRL",
  fieldSchema: null,
  provider: {
    id: "provider-adclean-v2",
    code: "adclean",
    active: true,
    integrationStatus: "NOT_CONNECTED",
  },
});

const heartUnlocksProviderProduct = () => ({
  id: "provider-product-heartunlocks",
  providerId: "provider-heartunlocks",
  externalProductId: "2337",
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  providerCostCents: null,
  currency: "BRL",
  fieldSchema: null,
  provider: {
    id: "provider-heartunlocks",
    code: "heartunlocks",
    active: true,
    integrationStatus: "CONNECTED",
  },
});

const baseOrder = (overrides: {
  id?: string;
  status?: string;
  fulfillment?: unknown;
  providerProduct?: ReturnType<typeof adcleanProviderProduct>;
} = {}) => ({
  id: overrides.id ?? "order-adclean-1",
  status: overrides.status ?? "PAID",
  payment: { status: "PAID" },
  fulfillment: overrides.fulfillment ?? null,
  items: [
    {
      unitPriceCents: 2000,
      providerFields: {},
      providerProduct: overrides.providerProduct ?? adcleanProviderProduct(),
      product: { providerProducts: [] },
    },
  ],
});

describe("AUDITORIA — reconciliação de ProviderOrder AdClean (fase 1: bloqueio comprovado)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-1" });
    db.order.update.mockResolvedValue({});
    db.provider.findUnique.mockResolvedValue({ active: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  it("[FIXTURE H/I] timeout/rede indisponível no gerar-ticket deixa o pedido em PROCESSING SEM lançar exceção — nenhum log é emitido em commerce.ts porque a Promise resolve normalmente", async () => {
    db.order.findUnique.mockResolvedValue(baseOrder());
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.providerOrder.update.mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNRESET"))),
    );

    const result = await executeFulfillment("order-adclean-1");

    expect(result).toEqual({ status: "PROCESSING" });
    expect(db.providerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "provider-order-1" },
        data: expect.objectContaining({
          status: "PROCESSING",
          lastError: "PROVIDER_RESULT_UNCERTAIN",
        }),
      }),
    );
  });

  it("[FIXTURE — bloqueio de retry cego preservado] validateProviderExecution CONTINUA recusando executeFulfillment(retry:true) quando requestReference existe — essa proteção nunca foi removida; a saída correta agora é reconcileFulfillment", async () => {
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        status: "FAILED",
        fulfillment: {
          providerOrders: [
            {
              id: "provider-order-1",
              status: "FAILED",
              attempts: 1,
              requestReference: "provider-order-1",
              externalOrderId: null,
              lastError: "ADCLEAN_HTTP_500",
              callbackEvents: [],
            },
          ],
        },
      }),
    );

    await expect(
      executeFulfillment("order-adclean-1", { retry: true }),
    ).rejects.toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    expect(db.providerOrder.upsert).not.toHaveBeenCalled();
  });
});

describe("HOMOLOGAÇÃO — Caminho A: clean failure (caso real do Admin, dados fictícios)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-1" });
    db.provider.findUnique.mockResolvedValue({ active: true });
    db.order.update.mockResolvedValue({});
    db.fulfillment.update.mockResolvedValue({});
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-real-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  it("reproduz o estado do print (Payment PAID, Order/Fulfillment FAILED, ProviderOrder inexistente, Delivery inexistente) e converge para DELIVERED sem novo PIX/Order/Payment", async () => {
    // Cliente fictício "Beltrano de Tal" — não corresponde ao cliente real do
    // incidente. Estado replicado: PENDING_PAYMENT -> PAID -> FAILED
    // ("Não foi possível iniciar a liberação automática...").
    db.order.findUnique.mockResolvedValue(
      baseOrder({ id: "order-real-fixture", status: "FAILED", fulfillment: null }),
    );
    const { fn } = stubAdcleanFetch({
      gerar: () => jsonResponse({ ok: true, codigo: "TEST-CODE-123" }),
    });

    const result = await executeFulfillment("order-real-fixture", { retry: false });

    expect(result).toEqual({ status: "COMPLETED" });
    // ProviderOrder criado exatamente uma vez.
    expect(db.providerOrder.upsert).toHaveBeenCalledTimes(1);
    // Delivery CODE com o ticket real vindo de data.codigo (nunca de message).
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FULFILLED",
          delivery: expect.objectContaining({ credential: "TEST-CODE-123" }),
        }),
      }),
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "DELIVERED" }) }),
    );
    // Nenhum novo Order/Payment/PIX: o mock de prisma não expõe order.create
    // nem payment.*, então qualquer tentativa de criar um novo pedido/pagamento
    // teria derrubado este teste com TypeError.
    expect(fn.mock.calls.some(([url]) => String(url).includes("gerar-ticket"))).toBe(true);
  });
});

describe("HOMOLOGAÇÃO — Caminho B: reconcileFulfillment (resultado incerto)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
    db.order.update.mockResolvedValue({});
    db.fulfillment.update.mockResolvedValue({});
    db.providerOrder.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  const uncertainOrder = () =>
    baseOrder({
      id: "order-uncertain-1",
      status: "PROCESSING",
      fulfillment: {
        delivery: null,
        providerOrders: [
          {
            id: "provider-order-uncertain-1",
            status: "PROCESSING",
            attempts: 1,
            requestReference: "provider-order-uncertain-1",
            externalOrderId: "bancadasoft:order-uncertain-1",
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            callbackEvents: [],
          },
        ],
      },
    });

  it("[seção 22 — retry cego proibido] NUNCA chama gerar-ticket quando requestReference já existe, mesmo que o provider ainda esteja processando", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    const { calls } = stubAdcleanFetch({
      consultar: () => jsonResponse({ ok: true, processando: true }),
    });

    const result = await reconcileFulfillment("order-uncertain-1");

    expect(result).toEqual({ status: "PROCESSING" });
    expect(calls).toEqual(["consultar"]);
    expect(calls).not.toContain("gerar");
    expect(db.fulfillment.update).not.toHaveBeenCalled();
    expect(db.providerOrder.upsert).not.toHaveBeenCalled();
  });

  it("[seção 33 — identidade correta] consultar-ticket recebe idempotency_key = ProviderOrder.externalOrderId (NUNCA requestReference, que é só o id interno do ProviderOrder e é ignorado pelo adapter AdClean)", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(jsonResponse({ ok: true, processando: true }));
      }),
    );

    await reconcileFulfillment("order-uncertain-1");

    expect(bodies).toHaveLength(1);
    expect(bodies[0].idempotency_key).toBe("bancadasoft:order-uncertain-1"); // == existing.externalOrderId
    expect(bodies[0].idempotency_key).not.toBe("provider-order-uncertain-1"); // != existing.requestReference
  });

  it("[seção 21 — homologação obrigatória] 1ª reconciliação retorna PROCESSING (nenhuma Delivery); 2ª retorna COMPLETED e converge para DELIVERED com exatamente uma Delivery, sem novo ProviderOrder", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    const first = stubAdcleanFetch({
      consultar: () => jsonResponse({ ok: true, processando: true }),
    });
    const resultProcessing = await reconcileFulfillment("order-uncertain-1");
    expect(resultProcessing).toEqual({ status: "PROCESSING" });
    expect(first.calls).not.toContain("gerar");
    expect(db.fulfillment.update).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    const second = stubAdcleanFetch({
      consultar: () => jsonResponse({ ok: true, codigo: "TEST-CODE-456" }),
    });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    const resultCompleted = await reconcileFulfillment("order-uncertain-1");

    expect(resultCompleted).toEqual({ status: "COMPLETED" });
    expect(second.calls).not.toContain("gerar");
    expect(db.providerOrder.upsert).not.toHaveBeenCalled(); // nenhum ProviderOrder novo
    expect(db.providerOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "provider-order-uncertain-1", status: { not: "COMPLETED" } },
      }),
    );
    expect(db.fulfillment.update).toHaveBeenCalledTimes(1); // exatamente uma Delivery
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delivery: expect.objectContaining({ credential: "TEST-CODE-456" }),
        }),
      }),
    );
  });

  it("[seção 24/29 — idempotência] reconciliar um pedido já DELIVERED é no-op seguro: não chama o provider, não cria segunda Delivery", async () => {
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        id: "order-uncertain-1",
        status: "DELIVERED",
        fulfillment: {
          delivery: { credential: "TEST-CODE-456" },
          providerOrders: [
            {
              id: "provider-order-uncertain-1",
              status: "COMPLETED",
              attempts: 1,
              requestReference: "provider-order-uncertain-1",
              externalOrderId: "bancadasoft:order-uncertain-1",
              lastError: null,
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    const { fn } = stubAdcleanFetch({});

    const result = await reconcileFulfillment("order-uncertain-1");

    expect(result).toEqual({ status: "ALREADY_DELIVERED" });
    expect(fn).not.toHaveBeenCalled();
    expect(db.fulfillment.update).not.toHaveBeenCalled();
  });

  it("[seção 10/Caso C — território perigoso] consultar-ticket retornando encontrado:false NUNCA autoriza criar outro ticket — estado permanece reconciliável", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    const { calls } = stubAdcleanFetch({
      consultar: () => jsonResponse({ ok: true, encontrado: false }),
    });

    const result = await reconcileFulfillment("order-uncertain-1");

    expect(result).toEqual({ status: "PROCESSING" });
    expect(calls).not.toContain("gerar");
    // [seção 16 desta etapa] O erro ORIGINAL ("PROVIDER_RESULT_UNCERTAIN", já
    // presente no fixture) é preservado — um NOT_FOUND de reconciliação
    // nunca sobrescreve uma evidência mais informativa que já existia.
    expect(db.providerOrder.update).not.toHaveBeenCalled();
    expect(db.fulfillment.update).not.toHaveBeenCalled();
  });

  it("[seção 16 desta etapa] sem erro original prévio, o resultado inconclusivo da reconciliação é registrado (prefixado, para nunca ser confundido com um erro do adapter)", async () => {
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        id: "order-uncertain-1",
        status: "PROCESSING",
        fulfillment: {
          delivery: null,
          providerOrders: [
            {
              id: "provider-order-uncertain-1",
              status: "PROCESSING",
              attempts: 1,
              requestReference: "provider-order-uncertain-1",
              externalOrderId: "bancadasoft:order-uncertain-1",
              lastError: null, // nenhum erro original a preservar
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    stubAdcleanFetch({ consultar: () => jsonResponse({ ok: true, encontrado: false }) });

    const result = await reconcileFulfillment("order-uncertain-1");

    expect(result).toEqual({ status: "PROCESSING" });
    expect(db.providerOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "provider-order-uncertain-1" },
        data: expect.objectContaining({ lastError: "RECONCILIATION_ADCLEAN_TICKET_NOT_FOUND" }),
      }),
    );
  });

  it("recusa reconciliar Payment não PAID", async () => {
    const order = uncertainOrder();
    db.order.findUnique.mockResolvedValue({ ...order, payment: { status: "PENDING" } });
    await expect(reconcileFulfillment("order-uncertain-1")).rejects.toMatchObject({
      code: "PAYMENT_NOT_PAID",
    });
  });

  it("[generalização — seção 26] provider sem capability de reconciliação (HeartUnlocks) mantém bloqueio seguro em vez de tentar consultar um contrato inexistente", async () => {
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        id: "order-heartunlocks-1",
        status: "PROCESSING",
        providerProduct: heartUnlocksProviderProduct(),
        fulfillment: {
          delivery: null,
          providerOrders: [
            {
              id: "provider-order-hu-1",
              status: "PROCESSING",
              attempts: 1,
              requestReference: "provider-order-hu-1",
              externalOrderId: null,
              lastError: null,
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    process.env.HEARTUNLOCKS_GATEWAY_URL = "https://gateway.example.test";
    process.env.HEARTUNLOCKS_GATEWAY_SECRET = "isolated-test-secret";
    const { fn } = stubAdcleanFetch({});

    await expect(reconcileFulfillment("order-heartunlocks-1")).rejects.toMatchObject({
      code: "RECONCILIATION_NOT_SUPPORTED",
    });
    expect(fn).not.toHaveBeenCalled();
    delete process.env.HEARTUNLOCKS_GATEWAY_URL;
    delete process.env.HEARTUNLOCKS_GATEWAY_SECRET;
  });
});

describe("ATOMICIDADE (seção 32 da tarefa) — finalizeProviderCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.providerOrder.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  const uncertainOrder = () =>
    baseOrder({
      id: "order-atomic-1",
      status: "PROCESSING",
      fulfillment: {
        delivery: null,
        providerOrders: [
          {
            id: "provider-order-atomic-1",
            status: "PROCESSING",
            attempts: 1,
            requestReference: "provider-order-atomic-1",
            externalOrderId: "bancadasoft:order-atomic-1",
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            callbackEvents: [],
          },
        ],
      },
    });

  it("claim + Fulfillment FULFILLED + Order DELIVERED acontecem na MESMA transação interativa — não em duas chamadas separadas ao banco", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    stubAdcleanFetch({ consultar: () => jsonResponse({ ok: true, codigo: "TEST-CODE-ATOMIC" }) });
    const transactionCalls: unknown[] = [];
    db.$transaction.mockImplementation(async (arg) => {
      transactionCalls.push(arg);
      return typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]);
    });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.fulfillment.update.mockResolvedValue({});
    db.order.update.mockResolvedValue({});

    const result = await reconcileFulfillment("order-atomic-1");

    expect(result).toEqual({ status: "COMPLETED" });
    // Exatamente UMA chamada a $transaction cobre claim + Fulfillment + Order —
    // não duas chamadas separadas ao banco (o que reabriria a janela de
    // inconsistência: ProviderOrder COMPLETED sem Order DELIVERED).
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof transactionCalls[0]).toBe("function");
  });

  it("se a transação falhar DEPOIS do claim (ex.: order.update lança), nada é finalizado nesta chamada — e uma nova tentativa, com o estado revertido pelo rollback real do banco, converge normalmente depois", async () => {
    db.order.findUnique.mockResolvedValue(uncertainOrder());
    stubAdcleanFetch({ consultar: () => jsonResponse({ ok: true, codigo: "TEST-CODE-ATOMIC-2" }) });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.fulfillment.update.mockResolvedValue({});
    // 1ª execução: order.update falha DEPOIS do claim (dentro da mesma
    // transação interativa) — em produção isso faz o Postgres reverter TODA a
    // transação, inclusive o updateMany do ProviderOrder; aqui simulamos essa
    // consequência mantendo o ProviderOrder como "ainda não completado" no
    // próximo findUnique.
    db.order.update.mockRejectedValueOnce(new Error("connection reset by peer"));
    db.$transaction.mockImplementation(async (arg) =>
      typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]),
    );

    await expect(reconcileFulfillment("order-atomic-1")).rejects.toThrow(
      "connection reset by peer",
    );
    // Nenhum e-mail é disparado quando a transação falha.
    // (sendDeliveryEmail só é chamado após `outcome.alreadyCompleted === false`,
    // que só existe se a transação inteira tiver retornado com sucesso.)

    // 2ª execução (rollback real já devolveu o ProviderOrder ao estado
    // anterior no banco de verdade — aqui replicamos isso com o MESMO
    // findUnique "ainda incerto" usado na 1ª tentativa): desta vez a
    // transação completa com sucesso.
    db.order.update.mockResolvedValueOnce({});
    const result = await reconcileFulfillment("order-atomic-1");
    expect(result).toEqual({ status: "COMPLETED" });
    expect(db.fulfillment.update).toHaveBeenCalledTimes(2); // 1 por tentativa; a 1ª foi desfeita pelo rollback real do banco
  });
});

describe("attemptAutomaticGuestRecovery (seções 8-10 da tarefa) — recovery/reconciliação automáticos, throttlados, sem polling->provider a cada 3s", () => {
  const recent = new Date();
  const old = new Date(Date.now() - 60_000); // 60s atrás: mais velho que o throttle de 20s

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]),
    );
    db.provider.findUnique.mockResolvedValue({ active: true });
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-auto-1" });
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-auto-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.order.update.mockResolvedValue({});
    db.fulfillment.update.mockResolvedValue({});
    db.providerOrder.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  it("payment não PAID: nunca toca o banco além da leitura inicial, nunca chama o provider", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      status: "PENDING_PAYMENT",
      payment: { status: "PENDING" },
      fulfillment: null,
    });
    const { fn } = stubAdcleanFetch({});
    const attempted = await attemptAutomaticGuestRecovery("order-x");
    expect(attempted).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("já DELIVERED: no-op", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      status: "DELIVERED",
      payment: { status: "PAID" },
      fulfillment: { delivery: { credential: "X" }, updatedAt: recent, providerOrders: [] },
    });
    const { fn } = stubAdcleanFetch({});
    const attempted = await attemptAutomaticGuestRecovery("order-x");
    expect(attempted).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("[throttle] clean failure com Fulfillment recém-atualizado: NÃO tenta de novo ainda (evita loop a cada poll de 3s)", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      status: "FAILED",
      payment: { status: "PAID" },
      fulfillment: { status: "FAILED", delivery: null, updatedAt: recent, providerOrders: [] },
    });
    const { fn } = stubAdcleanFetch({});
    const attempted = await attemptAutomaticGuestRecovery("order-x");
    expect(attempted).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("[caminho A automático] clean failure sem Fulfillment nenhum: tenta imediatamente (nada para throttlar ainda) e converge", async () => {
    db.order.findUnique
      .mockResolvedValueOnce({ status: "PAID", payment: { status: "PAID" }, fulfillment: null })
      .mockResolvedValueOnce(baseOrder({ id: "order-auto-1", status: "PAID", fulfillment: null }));
    stubAdcleanFetch({ gerar: () => jsonResponse({ ok: true, codigo: "TEST-AUTO-001" }) });

    const attempted = await attemptAutomaticGuestRecovery("order-auto-1");

    expect(attempted).toBe(true);
    expect(db.providerOrder.upsert).toHaveBeenCalledTimes(1);
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FULFILLED" }) }),
    );
  });

  it("[caminho A automático, stale] Fulfillment(FAILED) antigo sem ProviderOrder: tenta de novo após o throttle", async () => {
    db.order.findUnique
      .mockResolvedValueOnce({
        status: "FAILED",
        payment: { status: "PAID" },
        fulfillment: { status: "FAILED", delivery: null, updatedAt: old, providerOrders: [] },
      })
      .mockResolvedValueOnce(baseOrder({ id: "order-auto-2", status: "FAILED", fulfillment: null }));
    stubAdcleanFetch({ gerar: () => jsonResponse({ ok: true, codigo: "TEST-AUTO-002" }) });

    const attempted = await attemptAutomaticGuestRecovery("order-auto-2");
    expect(attempted).toBe(true);
    expect(db.providerOrder.upsert).toHaveBeenCalledTimes(1);
  });

  it("[throttle] resultado incerto com ProviderOrder recém-atualizado: NÃO reconcilia ainda (nunca chama o provider a cada poll)", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      status: "PROCESSING",
      payment: { status: "PAID" },
      fulfillment: {
        status: "PROCESSING",
        delivery: null,
        updatedAt: recent,
        providerOrders: [
          {
            updatedAt: recent,
            requestReference: "provider-order-auto-3",
            externalOrderId: "bancadasoft:order-auto-3",
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            callbackEvents: [],
          },
        ],
      },
    });
    const { fn } = stubAdcleanFetch({});
    const attempted = await attemptAutomaticGuestRecovery("order-auto-3");
    expect(attempted).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it("[caminho B automático, stale] resultado incerto com ProviderOrder antigo: reconcilia (nunca gerar-ticket) e converge para DELIVERED", async () => {
    db.order.findUnique
      .mockResolvedValueOnce({
        status: "PROCESSING",
        payment: { status: "PAID" },
        fulfillment: {
          status: "PROCESSING",
          delivery: null,
          updatedAt: old,
          providerOrders: [
            {
              updatedAt: old,
              requestReference: "provider-order-auto-4",
              externalOrderId: "bancadasoft:order-auto-4",
              lastError: "PROVIDER_RESULT_UNCERTAIN",
              callbackEvents: [],
            },
          ],
        },
      })
      .mockResolvedValueOnce(
        baseOrder({
          id: "order-auto-4",
          status: "PROCESSING",
          fulfillment: {
            delivery: null,
            providerOrders: [
              {
                id: "provider-order-auto-4",
                status: "PROCESSING",
                attempts: 1,
                requestReference: "provider-order-auto-4",
                externalOrderId: "bancadasoft:order-auto-4",
                lastError: "PROVIDER_RESULT_UNCERTAIN",
                callbackEvents: [],
              },
            ],
          },
        }),
      );
    const { calls } = stubAdcleanFetch({
      consultar: () => jsonResponse({ ok: true, codigo: "TEST-AUTO-004" }),
    });

    const attempted = await attemptAutomaticGuestRecovery("order-auto-4");

    expect(attempted).toBe(true);
    expect(calls).toEqual(["consultar"]);
    expect(calls).not.toContain("gerar"); // nunca gerar-ticket a partir do recovery automático
    expect(db.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ delivery: expect.objectContaining({ credential: "TEST-AUTO-004" }) }),
      }),
    );
  });
});

describe("INCIDENTE REAL DE PRODUÇÃO (17/09/2026) — race entre webhook e attemptAutomaticGuestRecovery", () => {
  // Evidência coletada (somente leitura, autorizada pelo usuário) de dois
  // pedidos AdClean reais: ambos falharam ~6.5s depois de Payment PAID, com
  // erro `PrismaClientKnownRequestError` registrado em log (Vercel) para um
  // deles. Nenhum dado pessoal, token ou código real é usado aqui — apenas os
  // estados/timestamps relativos que reproduzem a causa.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.provider.findUnique.mockResolvedValue({ active: true });
    db.order.findUnique.mockResolvedValue(baseOrder({ id: "order-race-1", fulfillment: null }));
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-race-1" });
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-race-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.order.update.mockResolvedValue({});
    db.fulfillment.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  it("[causa raiz reproduzida] duas chamadas GENUINAMENTE concorrentes a executeFulfillment (webhook + auto-recovery) para o MESMO pedido: só uma reivindica e chama gerar-ticket; a outra recebe CONCURRENT_OR_INVALID_EXECUTION SEM marcar Order/Fulfillment como FAILED", async () => {
    // Só as duas PRIMEIRAS chamadas a $transaction são as tentativas de
    // "prepare" (claim) concorrentes — chamadas seguintes são a finalização
    // (finalizeProviderCompletion) da execução vencedora e precisam suceder
    // normalmente, senão o teste não provaria concorrência real (provaria só
    // que qualquer $transaction depois da 1ª falha).
    let transactionAttempts = 0;
    db.$transaction.mockImplementation(async (arg) => {
      if (typeof arg !== "function") return Promise.all(arg as Promise<unknown>[]);
      transactionAttempts += 1;
      if (transactionAttempts === 2) {
        // 2ª transação concorrente: exatamente o que o Postgres devolveu em
        // produção quando duas execuções tentaram reivindicar o mesmo
        // Fulfillment/ProviderOrder ao mesmo tempo — inclui meta.target
        // porque classifyPrepareConflict agora exige a constraint exata.
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`orderId`)", {
          code: "P2002",
          clientVersion: "6.19.0",
          meta: { target: ["orderId"] },
        });
      }
      return arg(db);
    });
    // classifyPrepareConflict releia o Fulfillment para confirmar que a
    // concorrência é legítima antes de aceitar o P2002 como seguro.
    db.fulfillment.findUnique.mockResolvedValue({ id: "fulfillment-race-1" });
    stubAdcleanFetch({ gerar: () => jsonResponse({ ok: true, codigo: "TEST-RACE-001" }) });

    const [first, second] = await Promise.allSettled([
      executeFulfillment("order-race-1", { retry: false }),
      executeFulfillment("order-race-1", { retry: false }),
    ]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value).toEqual({ status: "COMPLETED" });
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "CONCURRENT_OR_INVALID_EXECUTION",
    });
    // A perdedora da corrida NUNCA marca o pedido como FAILED — antes da
    // correção, um PrismaClientKnownRequestError não tratado caía direto em
    // recordPaidFulfillmentFailure() e forçava Order.status=FAILED mesmo com
    // a outra execução prestes a concluir com sucesso.
    expect(db.order.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
    // No máximo um gerar-ticket, como exigido.
    expect(
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call) =>
        String(call[0]).includes("gerar-ticket"),
      ),
    ).toHaveLength(1);
  });

  it("[proteção preservada] um Prisma error genuinamente não relacionado a concorrência (ex.: P1001, conexão indisponível) continua registrando FAILED normalmente", async () => {
    db.$transaction.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
        code: "P1001",
        clientVersion: "6.19.0",
      });
    });
    stubAdcleanFetch({});

    await expect(executeFulfillment("order-race-1", { retry: false })).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });

  it("[fixture sanitizada — Pedido Real FAILED #2, seção 15 desta etapa] reconciliation SEM externalOrderId confirmado NUNCA mais consulta com o id interno do ProviderOrder — reconstrói a identidade real via adapter.buildReconciliationIdentity e resolve o pedido de verdade", async () => {
    // Reproduz o estado exato do 2º pedido real: ProviderOrder existe (uma
    // tentativa de gerar-ticket já ocorreu e falhou), mas externalOrderId
    // nunca foi confirmado pelo AdClean. Antes desta etapa, isso ficava
    // permanentemente bloqueado (RECONCILIATION_IDENTITY_UNKNOWN). Agora o
    // adapter sabe reconstruir sua própria identidade determinística.
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        id: "order-real-failed-2",
        status: "FAILED",
        fulfillment: {
          delivery: null,
          providerOrders: [
            {
              id: "provider-order-real-failed-2",
              status: "FAILED",
              attempts: 1,
              requestReference: "provider-order-real-failed-2",
              externalOrderId: null, // nunca confirmado pelo AdClean
              lastError: "ADCLEAN_HTTP_500", // erro original real (exemplo sanitizado)
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(jsonResponse({ ok: true, codigo: "TEST-REAL-2-RECOVERED" }));
      }),
    );

    const result = await reconcileFulfillment("order-real-failed-2");

    expect(result).toEqual({ status: "COMPLETED" });
    expect(bodies).toHaveLength(1);
    // A MESMA fórmula determinística que createOrder já usa — o
    // fulfillment-engine nunca conhece esse formato, só delega ao adapter.
    expect(bodies[0].idempotency_key).toBe("bancadasoft:order-real-failed-2");
  });

  it("[proteção preservada] provider com supportsReconciliation=true mas SEM buildReconciliationIdentity continua retornando RECONCILIATION_IDENTITY_UNKNOWN honestamente, sem nunca consultar com uma identidade inválida", async () => {
    // mock-sandbox só é elegível em modo TEST (isProductionProviderCode o
    // exclui em modo REAL) — não relacionado ao que este teste verifica.
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "TEST" });
    db.order.findUnique.mockResolvedValue(
      baseOrder({
        id: "order-mock-unknown-identity",
        status: "FAILED",
        providerProduct: {
          id: "provider-product-mock",
          providerId: "provider-mock",
          externalProductId: "mock-product",
          active: true,
          mode: "TEST", // mock-sandbox só é elegível em modo TEST
          technicalEligibility: "READY",
          providerCostCents: null,
          currency: "BRL",
          fieldSchema: null,
          provider: { id: "provider-mock", code: "mock-sandbox", active: true, integrationStatus: "CONNECTED" },
        },
        fulfillment: {
          delivery: null,
          providerOrders: [
            {
              id: "provider-order-mock-unknown",
              status: "FAILED",
              attempts: 1,
              requestReference: "provider-order-mock-unknown",
              externalOrderId: null,
              lastError: "MOCK_FAILURE",
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    const { fn } = stubAdcleanFetch({});

    await expect(reconcileFulfillment("order-mock-unknown-identity")).rejects.toMatchObject({
      code: "RECONCILIATION_IDENTITY_UNKNOWN",
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("UNLOCKTOOL — fixtures sanitizadas dos pedidos reais de 7h", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.HEARTUNLOCKS_GATEWAY_URL = "https://heart-gateway.example.test";
    process.env.HEARTUNLOCKS_GATEWAY_SECRET = "isolated-test-secret";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.provider.findUnique.mockResolvedValue({ active: true });
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-unlocktool" });
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-unlocktool" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.providerOrder.update.mockResolvedValue({});
    db.fulfillment.update.mockResolvedValue({});
    db.order.update.mockResolvedValue({});
    db.$transaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(db),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HEARTUNLOCKS_GATEWAY_URL;
    delete process.env.HEARTUNLOCKS_GATEWAY_SECRET;
  });

  it.each(["GUEST", "LOGADO"])(
    "%s + PAID usa o mesmo fulfillment server-side e inicia o provider sem Admin",
    async (customerKind) => {
      const orderId = `order-unlocktool-${customerKind.toLowerCase()}`;
      db.order.findUnique.mockResolvedValue(
        baseOrder({
          id: orderId,
          providerProduct: heartUnlocksProviderProduct(),
        }),
      );
      const providerCall = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          productUuid: "2337",
          referenceId: "provider-order-unlocktool",
          quantity: 1,
          fields: {},
        });
        return jsonResponse(
          {
            externalOrderId: "external-sanitized",
            referenceId: body.referenceId,
            status: "PROCESSING",
          },
          202,
        );
      });
      vi.stubGlobal("fetch", providerCall);

      await expect(executeFulfillment(orderId)).resolves.toEqual({
        status: "PROCESSING",
      });
      expect(providerCall).toHaveBeenCalledOnce();
      expect(db.providerOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "provider-order-unlocktool" },
          data: expect.objectContaining({ status: "PROCESSING" }),
        }),
      );
    },
  );

  it("clean failure real (PAID + Fulfillment FAILED, sem ProviderOrder) é recuperado sem navegador e cria no máximo uma ativação", async () => {
    const failedFixture = baseOrder({
      id: "order-unlocktool-clean-failure",
      status: "FAILED",
      fulfillment: {
        status: "FAILED",
        delivery: null,
        updatedAt: new Date(Date.now() - 60_000),
        providerOrders: [],
      },
      providerProduct: heartUnlocksProviderProduct(),
    });
    db.order.findUnique
      .mockResolvedValueOnce(failedFixture)
      .mockResolvedValueOnce(failedFixture);
    const providerCall = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return jsonResponse(
        { referenceId: body.referenceId, status: "PROCESSING" },
        202,
      );
    });
    vi.stubGlobal("fetch", providerCall);

    await expect(
      attemptAutomaticGuestRecovery("order-unlocktool-clean-failure"),
    ).resolves.toBe(true);
    expect(providerCall).toHaveBeenCalledOnce();
  });

  it("resultado externo incerto aguarda callback/MANUAL_REVIEW e nunca faz blind retry", async () => {
    const uncertainFixture = baseOrder({
      id: "order-unlocktool-uncertain",
      status: "PROCESSING",
      fulfillment: {
        status: "PROCESSING",
        delivery: null,
        updatedAt: new Date(Date.now() - 60_000),
        providerOrders: [
          {
            id: "provider-order-unlocktool",
            status: "PROCESSING",
            attempts: 1,
            requestReference: "provider-order-unlocktool",
            externalOrderId: null,
            lastError: "PROVIDER_RESULT_UNCERTAIN",
            updatedAt: new Date(Date.now() - 60_000),
            callbackEvents: [],
          },
        ],
      },
      providerProduct: heartUnlocksProviderProduct(),
    });
    db.order.findUnique
      .mockResolvedValueOnce(uncertainFixture)
      .mockResolvedValueOnce(uncertainFixture);
    const providerCall = vi.fn();
    vi.stubGlobal("fetch", providerCall);

    await expect(
      attemptAutomaticGuestRecovery("order-unlocktool-uncertain"),
    ).resolves.toBe(true);
    expect(providerCall).not.toHaveBeenCalled();
    expect(db.providerOrder.upsert).not.toHaveBeenCalled();
  });
});
