import { describe, expect, it, vi } from "vitest";
import {
  ADCLEAN_DEFAULT_BASE_URL,
  AdcleanProviderAdapter,
  AdcleanProviderError,
  adcleanConfigured,
  normalizeAdcleanBaseUrl,
} from "./adclean";
import {
  ProviderOrderUncertainError,
  ProviderReconciliationRequiredError,
} from "./types";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const input = (paidAmountCents = 2000) => ({
  providerProductId: "ticket-168h",
  reference: "fulfillment-1",
  payload: {
    orderId: "order-1",
    paidAmountCents,
    Quantity: 1,
    fields: {},
  },
});

function adapter(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  sleep?: (milliseconds: number) => Promise<void>,
) {
  return new AdcleanProviderAdapter({
    token: "test-token-not-a-real-secret",
    fetcher,
    sleep,
  });
}

function parsedBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<
    string,
    unknown
  >;
}

describe("AdClean v2 adapter", () => {
  it("gera um ticket e normaliza a entrega como CODE", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(200, { ok: true, codigo: "TEST-CODE", ticket_id: "ticket-1" }),
    );
    const result = await adapter(fetcher).createOrder(input());

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(
      `${ADCLEAN_DEFAULT_BASE_URL}/admin/gerar-ticket`,
    );
    expect(parsedBody(fetcher.mock.calls[0])).toMatchObject({
      duracao_horas: 168,
      valor: 20,
      expira_em_dias: null,
      idempotency_key: "bancadasoft:order-1",
      external_order_id: "order-1",
      partner: "bancadasoft",
    });
    expect(result).toMatchObject({
      externalOrderId: "bancadasoft:order-1",
      status: "COMPLETED",
      delivery: { deliveryType: "CODE", credential: "TEST-CODE" },
    });
    expect(JSON.stringify(result)).not.toContain("test-token-not-a-real-secret");
  });

  it.each([
    [2000, 20],
    [1000, 10],
  ])("envia o preço persistido de %i centavos como %d reais", async (cents, reais) => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { ok: true, codigo: "CODE" }));
    await adapter(fetcher).createOrder(input(cents));
    expect(parsedBody(fetcher.mock.calls[0]).valor).toBe(reais);
  });

  it("mantém a mesma chave em uma resposta idempotente reconciliada", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(200, { ok: true, codigo: "CODE", reconciliado: false }))
      .mockResolvedValueOnce(json(200, { ok: true, codigo: "CODE", reconciliado: true }));
    const service = adapter(fetcher);
    await service.createOrder(input());
    await service.createOrder(input());
    expect(parsedBody(fetcher.mock.calls[0]).idempotency_key).toBe(
      parsedBody(fetcher.mock.calls[1]).idempotency_key,
    );
  });

  it("reconcilia após timeout e reutiliza o ticket encontrado", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network failure"))
      .mockResolvedValueOnce(json(200, { ok: true, encontrado: true, codigo: "FOUND" }));
    const result = await adapter(fetcher).createOrder(input());
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      `${ADCLEAN_DEFAULT_BASE_URL}/admin/gerar-ticket`,
      `${ADCLEAN_DEFAULT_BASE_URL}/admin/consultar-ticket`,
    ]);
    expect(result.delivery).toMatchObject({ credential: "FOUND" });
  });

  it("regenera com a mesma chave somente após consulta não encontrada", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network failure"))
      .mockResolvedValueOnce(json(200, { ok: true, encontrado: false }))
      .mockResolvedValueOnce(json(200, { ok: true, codigo: "CREATED" }));
    await adapter(fetcher).createOrder(input());
    expect(parsedBody(fetcher.mock.calls[0]).idempotency_key).toBe(
      parsedBody(fetcher.mock.calls[2]).idempotency_key,
    );
  });

  it("aguarda 300ms e consulta quando o ticket está processando", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json(409, { ok: false, erro: "idempotency_processando_tente_novamente" }),
      )
      .mockResolvedValueOnce(json(200, { ok: true, encontrado: true, codigo: "READY" }));
    const result = await adapter(fetcher, sleep).createOrder(input());
    expect(sleep).toHaveBeenCalledWith(300);
    expect(result.status).toBe("COMPLETED");
  });

  it("exige reconciliação e não inventa chave após conflito", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(409, { ok: false, erro: "idempotency_conflict" }),
    );
    await expect(adapter(fetcher).createOrder(input())).rejects.toBeInstanceOf(
      ProviderReconciliationRequiredError,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    [401, "nao_autorizado", "ADCLEAN_NOT_AUTHORIZED"],
    [400, "body_invalido", "ADCLEAN_BODY_INVALID"],
  ])("mapeia HTTP %i sem vazar resposta", async (status, erro, expected) => {
    const fetcher = vi.fn().mockResolvedValue(json(status, { ok: false, erro }));
    await expect(adapter(fetcher).createOrder(input())).rejects.toMatchObject<AdcleanProviderError>({
      code: expected,
    });
  });

  it("mantém resultado incerto após falhas de transporte repetidas", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network failure"));
    await expect(adapter(fetcher).createOrder(input())).rejects.toBeInstanceOf(
      ProviderOrderUncertainError,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("consulta status sem gerar novo ticket", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(200, { ok: true, encontrado: true, processando: true }),
    );
    const result = await adapter(fetcher).getOrderStatus("bancadasoft:order-1");
    expect(result.status).toBe("PROCESSING");
    expect(fetcher.mock.calls[0][0]).toContain("/admin/consultar-ticket");
  });
});

describe("configuração AdClean", () => {
  it("exige token e URL HTTPS oficial/configurada sem credenciais", () => {
    expect(adcleanConfigured("", ADCLEAN_DEFAULT_BASE_URL)).toBe(false);
    expect(adcleanConfigured("token", "http://example.com")).toBe(false);
    expect(normalizeAdcleanBaseUrl(`${ADCLEAN_DEFAULT_BASE_URL}/`)).toBe(
      ADCLEAN_DEFAULT_BASE_URL,
    );
    expect(() => normalizeAdcleanBaseUrl("https://user:pass@example.com")).toThrow(
      "ADCLEAN_BASE_URL_INVALID",
    );
  });
});
