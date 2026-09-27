import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  ADCLEAN_LICENSE_CODE,
  AdcleanLicenseAdapter,
  AdcleanLicenseDisconnectedAdapter,
  AdcleanLicenseError,
  adcleanLicenseConfigured,
  adcleanLicenseIdentity,
  configuredAdcleanLicenseAdapter,
  type AdcleanLicenseOrder,
} from "./adclean-license";
import { ADCLEAN_DEFAULT_BASE_URL } from "./adclean";
import { resolveProviderAdapter } from "./registry";
import { ProviderNotConnectedError, ProviderOrderUncertainError } from "./types";

const TOKEN = "test-license-token-not-a-real-secret";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const licenseOrder = (overrides: Partial<AdcleanLicenseOrder> = {}): AdcleanLicenseOrder => ({
  email: "  Cliente@Example.com ",
  externalProductId: "licenca-8760h",
  providerCode: ADCLEAN_LICENSE_CODE,
  metadata: { periodo_horas: 8760 },
  ...overrides,
});

function adapter(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  order: AdcleanLicenseOrder | null = licenseOrder(),
) {
  return new AdcleanLicenseAdapter({ token: TOKEN, fetcher, loadOrder: async () => order });
}

const run = (a: AdcleanLicenseAdapter, providerProductId = "licenca-8760h") =>
  a.createOrder({
    providerProductId,
    reference: "provider-order-1",
    payload: { orderId: "order-1", paidAmountCents: 9900, Quantity: 1, fields: {} },
  });

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

describe("AdcleanLicenseAdapter — geração (/admin/gerar)", () => {
  it("gera a licença com token no corpo, idempotency_key e external_order_id do Order", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(200, { ok: true, codigo: "ABCD-1234", email: "cliente@example.com", periodo_horas: 8760 }),
    );
    const result = await run(adapter(fetcher));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe(`${ADCLEAN_DEFAULT_BASE_URL}/admin/gerar`);
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(bodyOf(fetcher.mock.calls[0])).toEqual({
      token: TOKEN,
      periodo_horas: 8760,
      email: "cliente@example.com",
      idempotency_key: "bancadasoft-licenca:order-1",
      external_order_id: "order-1",
    });
    expect(result).toMatchObject({
      externalOrderId: "bancadasoft-licenca:order-1",
      status: "COMPLETED",
      delivery: {
        deliveryType: "CODE",
        credential: "ABCD-1234",
        adcleanLicense: { codigo: "ABCD-1234", email: "cliente@example.com", periodo_horas: 8760, reconciliado: false },
      },
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("chave repetida volta reconciliado:true e é tratada como sucesso", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(200, { ok: true, codigo: "ABCD-1234", email: "cliente@example.com", periodo_horas: 8760, reconciliado: true }),
    );
    const result = await run(adapter(fetcher));
    expect(result.status).toBe("COMPLETED");
    expect(result.delivery).toMatchObject({ adcleanLicense: { reconciliado: true } });
  });

  it.each([
    ["idempotency_conflict", "ADCLEAN_LICENSE_IDEMPOTENCY_CONFLICT"],
    ["idempotency_processando_tente_novamente", "ADCLEAN_LICENSE_IDEMPOTENCY_PROCESSING"],
  ])("409 %s vira PROCESSING (tentar novamente), nunca FAILED", async (erro, error) => {
    const fetcher = vi.fn().mockResolvedValue(json(409, { ok: false, erro }));
    const result = await run(adapter(fetcher));
    expect(result).toEqual({
      externalOrderId: "bancadasoft-licenca:order-1",
      reference: "bancadasoft-licenca:order-1",
      status: "PROCESSING",
      error,
    });
  });

  it("429 limite do parceiro vira PROCESSING", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(429, { ok: false, erro: "limite_parceiro_excedido" }));
    expect((await run(adapter(fetcher))).status).toBe("PROCESSING");
  });

  it("400 periodo_invalido do AdClean é falha definitiva", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(400, { ok: false, erro: "periodo_invalido" }));
    await expect(run(adapter(fetcher))).rejects.toMatchObject({ code: "ADCLEAN_LICENSE_PERIOD_INVALID" });
  });

  it.each([{}, { periodo_horas: "8760" }, { periodo_horas: 0 }, null])(
    "metadata sem periodo_horas válido (%j) falha antes de chamar o AdClean",
    async (metadata) => {
      const fetcher = vi.fn();
      await expect(run(adapter(fetcher, licenseOrder({ metadata })))).rejects.toMatchObject({
        code: "ADCLEAN_LICENSE_PERIOD_INVALID",
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, "email_obrigatorio", "ADCLEAN_LICENSE_EMAIL_REQUIRED"],
    [400, "email_invalido", "ADCLEAN_LICENSE_EMAIL_INVALID"],
    [400, "body_invalido", "ADCLEAN_LICENSE_BODY_INVALID"],
    [401, "nao_autorizado", "ADCLEAN_LICENSE_NOT_AUTHORIZED"],
  ])("%i %s é falha definitiva %s", async (status, erro, code) => {
    const fetcher = vi.fn().mockResolvedValue(json(status, { ok: false, erro }));
    const error = await run(adapter(fetcher)).catch((e) => e);
    expect(error).toBeInstanceOf(AdcleanLicenseError);
    expect(error.code).toBe(code);
  });

  it("500 sem JSON: repete uma vez com a mesma chave e aceita o código reconciliado", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(json(200, { ok: true, codigo: "ABCD-1234", reconciliado: true }));
    const result = await run(adapter(fetcher));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetcher.mock.calls[1]).idempotency_key).toBe("bancadasoft-licenca:order-1");
    expect(result.status).toBe("COMPLETED");
  });

  it("500/rede duas vezes: resultado incerto (engine deixa PROCESSING)", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(run(adapter(fetcher))).rejects.toBeInstanceOf(ProviderOrderUncertainError);
  });

  it("recusa ProviderProduct de outro provider ou diferente do comprado", async () => {
    const fetcher = vi.fn();
    await expect(run(adapter(fetcher, licenseOrder({ providerCode: "adclean" })))).rejects.toMatchObject({
      code: "ADCLEAN_LICENSE_PROVIDER_PRODUCT_MISMATCH",
    });
    await expect(run(adapter(fetcher), "licenca-12h")).rejects.toMatchObject({
      code: "ADCLEAN_LICENSE_PROVIDER_PRODUCT_MISMATCH",
    });
    await expect(run(adapter(fetcher, null))).rejects.toMatchObject({ code: "ADCLEAN_LICENSE_ORDER_NOT_FOUND" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("AdcleanLicenseAdapter — reconciliação", () => {
  it("identidade determinística a partir do orderId", () => {
    const a = adapter(vi.fn());
    expect(a.supportsReconciliation).toBe(true);
    expect(a.buildReconciliationIdentity(" order-1 ")).toBe("bancadasoft-licenca:order-1");
    expect(adcleanLicenseIdentity("order-1")).toBe("bancadasoft-licenca:order-1");
  });

  it("getOrderStatus repete /admin/gerar com o mesmo corpo reconstruído do Order", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { ok: true, codigo: "ABCD-1234", reconciliado: true }));
    const result = await adapter(fetcher).getOrderStatus("bancadasoft-licenca:order-1");
    expect(bodyOf(fetcher.mock.calls[0])).toMatchObject({
      idempotency_key: "bancadasoft-licenca:order-1",
      external_order_id: "order-1",
      periodo_horas: 8760,
      email: "cliente@example.com",
    });
    expect(result.status).toBe("COMPLETED");
  });

  it("getOrderStatus recusa identidade de outro formato sem chamar o AdClean", async () => {
    const fetcher = vi.fn();
    const result = await adapter(fetcher).getOrderStatus("bancadasoft:order-1");
    expect(result).toMatchObject({ status: "FAILED", error: "ADCLEAN_LICENSE_IDENTITY_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("AdcleanLicenseAdapter — reenvio (/admin/reenviar-codigo)", () => {
  it("reenvia por código", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { ok: true, codigo: "ABCD-1234", email: "c@x.com", enviado: true }));
    const result = await adapter(fetcher).resendCode({ codigo: " ABCD-1234 " });
    expect(fetcher.mock.calls[0][0]).toBe(`${ADCLEAN_DEFAULT_BASE_URL}/admin/reenviar-codigo`);
    expect(bodyOf(fetcher.mock.calls[0])).toEqual({ token: TOKEN, codigo: "ABCD-1234" });
    expect(result).toEqual({ ok: true, codigo: "ABCD-1234", email: "c@x.com" });
  });

  it("reenvia pelo id do nosso Order (external_order_id)", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(200, { ok: true, codigo: "ABCD-1234", email: "c@x.com", enviado: true }));
    await adapter(fetcher).resendCode({ orderId: "order-1" });
    expect(bodyOf(fetcher.mock.calls[0])).toEqual({ token: TOKEN, external_order_id: "order-1" });
  });

  it.each([
    [429, "aguarde_reenvio", true],
    [502, "falha_envio_email", true],
    [404, "nao_encontrado", false],
    [409, "pedido_com_varios_codigos", false],
    [409, "codigo_ja_usado", false],
    [422, "codigo_sem_email", false],
    [401, "nao_autorizado", false],
    [400, "campos_faltando", false],
  ])("%i %s → retry=%s", async (status, erro, retry) => {
    const fetcher = vi.fn().mockResolvedValue(json(status, { ok: false, erro }));
    expect(await adapter(fetcher).resendCode({ codigo: "ABCD-1234" })).toEqual({
      ok: false,
      retry,
      error: `ADCLEAN_LICENSE_RESEND_${erro.toUpperCase()}`,
    });
  });

  it("falha de rede no reenvio é 'tentar novamente', sem exceção", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network"));
    expect(await adapter(fetcher).resendCode({ codigo: "X" })).toMatchObject({ ok: false, retry: true });
  });
});

describe("AdcleanLicenseAdapter — configuração", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sem ADCLEAN_LICENSE_PARTNER_TOKEN: adapter desconectado, sem exceção não tratada", async () => {
    vi.stubEnv("ADCLEAN_LICENSE_PARTNER_TOKEN", "");
    vi.stubEnv("ADCLEAN_PARTNER_TOKEN", "token-do-ticket-nao-serve");
    expect(adcleanLicenseConfigured()).toBe(false);
    const resolved = resolveProviderAdapter("adclean-license");
    expect(resolved).toBeInstanceOf(AdcleanLicenseDisconnectedAdapter);
    expect(resolved?.supportsReconciliation).toBe(false);
    expect(await resolved!.checkConnection()).toEqual({ connected: false, message: "Não conectado" });
    await expect(resolved!.createOrder({ providerProductId: "x", reference: "r", payload: {} })).rejects.toBeInstanceOf(
      ProviderNotConnectedError,
    );
    expect(await (resolved as AdcleanLicenseDisconnectedAdapter).resendCode()).toEqual({
      ok: false,
      retry: false,
      error: "ADCLEAN_LICENSE_NOT_CONFIGURED",
    });
  });

  it("com token: registry resolve o adapter real com código próprio", () => {
    vi.stubEnv("ADCLEAN_LICENSE_PARTNER_TOKEN", TOKEN);
    vi.stubEnv("ADCLEAN_BASE_URL", "");
    const resolved = configuredAdcleanLicenseAdapter();
    expect(resolved).toBeInstanceOf(AdcleanLicenseAdapter);
    expect(resolveProviderAdapter("adclean-license")?.code).toBe("adclean-license");
  });

  it("ADCLEAN_BASE_URL inválida conta como não configurado", () => {
    expect(adcleanLicenseConfigured(TOKEN, "http://inseguro.example")).toBe(false);
  });
});
