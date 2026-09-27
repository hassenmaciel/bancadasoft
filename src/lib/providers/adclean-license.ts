import { prisma } from "@/lib/prisma";
import { ADCLEAN_DEFAULT_BASE_URL, normalizeAdcleanBaseUrl } from "./adclean";
import type {
  ProviderAdapter,
  ProviderBalance,
  ProviderCatalogItem,
  ProviderHealth,
  ProviderOrderInput,
  ProviderOrderResult,
} from "./types";
import { ProviderNotConnectedError, ProviderOrderUncertainError } from "./types";

// Revenda de Licença Anual do AdClean: provider próprio, independente do
// ticket avulso (adclean.ts). Rotas: POST /admin/gerar e
// POST /admin/reenviar-codigo, token sempre no corpo JSON.
//
// A entrega ao cliente final é feita pelo próprio AdClean (e-mail com o
// código); o código fica guardado no Fulfillment.delivery só para suporte.
export const ADCLEAN_LICENSE_CODE = "adclean-license";
const IDENTITY_PREFIX = "bancadasoft-licenca:";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type AdcleanLicenseOrder = {
  email: string;
  externalProductId: string;
  providerCode: string;
  metadata: unknown;
};
export type OrderLookup = (orderId: string) => Promise<AdcleanLicenseOrder | null>;

export class AdcleanLicenseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AdcleanLicenseError";
  }
}

// Mesmo padrão de idempotência do saldo/revenda: identidade determinística a
// partir do id do nosso Order. Prefixo próprio porque a tabela de
// idempotência do AdClean é compartilhada com o ticket (bancadasoft:<id>).
export function adcleanLicenseIdentity(orderId: string) {
  const normalized = orderId.trim();
  if (!normalized) throw new AdcleanLicenseError("ADCLEAN_LICENSE_ORDER_ID_REQUIRED");
  return `${IDENTITY_PREFIX}${normalized}`;
}

// periodo_horas vem SEMPRE do ProviderProduct comprado (metadata), nunca do
// payload do checkout. A lista de períodos aceitos é do AdClean (400
// periodo_invalido); aqui só se barra o que nem é um número de horas.
export function periodoHorasFromMetadata(metadata: unknown) {
  const value =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).periodo_horas
      : undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new AdcleanLicenseError("ADCLEAN_LICENSE_PERIOD_INVALID");
  return value;
}

export function adcleanLicenseConfigured(
  token = process.env.ADCLEAN_LICENSE_PARTNER_TOKEN,
  baseUrl = process.env.ADCLEAN_BASE_URL,
) {
  if (!token?.trim()) return false;
  try {
    normalizeAdcleanBaseUrl(baseUrl || ADCLEAN_DEFAULT_BASE_URL);
    return true;
  } catch {
    return false;
  }
}

// O payload do engine (buildProviderExecutionPayload) não traz o comprador:
// como no BalanceTopupAdapter, o adapter lê o próprio Order.
const prismaOrderLookup: OrderLookup = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      customer: { select: { email: true } },
      items: {
        take: 1,
        select: {
          providerProduct: {
            select: { externalProductId: true, metadata: true, provider: { select: { code: true } } },
          },
        },
      },
    },
  });
  const purchased = order?.items[0]?.providerProduct;
  if (!order || !purchased) return null;
  return {
    email: order.customer.email,
    externalProductId: purchased.externalProductId,
    providerCode: purchased.provider.code,
    metadata: purchased.metadata,
  };
};

const periodoLabel = (horas: number) =>
  horas === 8760 ? "1 ano" : horas === 4320 ? "6 meses" : `${horas} horas`;

type GenerationContract = {
  periodo_horas: number;
  email: string;
  idempotency_key: string;
  external_order_id: string;
};

export type AdcleanLicenseResendResult =
  | { ok: true; codigo: string; email: string }
  // retry=true: vale tentar de novo mais tarde (429/502/rede/5xx).
  | { ok: false; retry: boolean; error: string };

export class AdcleanLicenseAdapter implements ProviderAdapter {
  readonly code = ADCLEAN_LICENSE_CODE;
  // Não há rota de consulta: a "consulta" repete /admin/gerar com a MESMA
  // idempotency_key e o MESMO corpo, que o AdClean devolve como
  // reconciliado:true sem gerar outro código.
  readonly supportsReconciliation = true;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly options: {
      token: string;
      baseUrl?: string;
      fetcher?: Fetcher;
      timeoutMs?: number;
      loadOrder?: OrderLookup;
    },
  ) {
    this.token = options.token.trim();
    if (!this.token) throw new Error("ADCLEAN_LICENSE_PARTNER_TOKEN_MISSING");
    this.baseUrl = normalizeAdcleanBaseUrl(options.baseUrl || ADCLEAN_DEFAULT_BASE_URL);
  }

  async checkConnection(): Promise<ProviderHealth> {
    return { connected: true, message: "Configuração AdClean (licença) disponível" };
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    return [];
  }

  async getBalance(): Promise<ProviderBalance> {
    throw new Error("ADCLEAN_LICENSE_BALANCE_NOT_SUPPORTED");
  }

  private async post(path: "/admin/gerar" | "/admin/reenviar-codigo", body: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: this.token, ...body }),
        signal: controller.signal,
      });
    } catch {
      throw new ProviderOrderUncertainError();
    } finally {
      clearTimeout(timer);
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, data, errorCode: typeof data?.erro === "string" ? data.erro : null };
  }

  private async contractFor(orderId: string, providerProductId?: string): Promise<GenerationContract> {
    const identity = adcleanLicenseIdentity(orderId);
    const order = await (this.options.loadOrder ?? prismaOrderLookup)(orderId.trim());
    if (!order) throw new AdcleanLicenseError("ADCLEAN_LICENSE_ORDER_NOT_FOUND");
    if (
      order.providerCode !== ADCLEAN_LICENSE_CODE ||
      (providerProductId !== undefined && order.externalProductId !== providerProductId)
    )
      throw new AdcleanLicenseError("ADCLEAN_LICENSE_PROVIDER_PRODUCT_MISMATCH");
    // Normalizado como o AdClean grava: a repetição da chave compara o
    // e-mail normalizado, então o corpo precisa ser estável entre tentativas.
    const email = order.email.trim().toLowerCase();
    if (!email) throw new AdcleanLicenseError("ADCLEAN_LICENSE_EMAIL_REQUIRED");
    return {
      periodo_horas: periodoHorasFromMetadata(order.metadata),
      email,
      idempotency_key: identity,
      external_order_id: orderId.trim(),
    };
  }

  private processing(identity: string, error: string): ProviderOrderResult {
    return { externalOrderId: identity, reference: identity, status: "PROCESSING", error };
  }

  private async generate(contract: GenerationContract): Promise<ProviderOrderResult> {
    const identity = contract.idempotency_key;
    const { status, data, errorCode } = await this.post("/admin/gerar", contract);

    // Sem sandbox: tudo que pode resolver sozinho numa nova tentativa fica
    // PROCESSING (reconciliável), nunca FAILED definitivo.
    if (status === 409 && errorCode === "idempotency_processando_tente_novamente")
      return this.processing(identity, "ADCLEAN_LICENSE_IDEMPOTENCY_PROCESSING");
    if (status === 409 && errorCode === "idempotency_conflict")
      return this.processing(identity, "ADCLEAN_LICENSE_IDEMPOTENCY_CONFLICT");
    if (status === 429) return this.processing(identity, "ADCLEAN_LICENSE_RATE_LIMITED");
    if (status >= 500) throw new ProviderOrderUncertainError();

    if (status === 401) throw new AdcleanLicenseError("ADCLEAN_LICENSE_NOT_AUTHORIZED");
    if (status === 403) throw new AdcleanLicenseError("ADCLEAN_LICENSE_SCOPE_NOT_ALLOWED");
    if (status === 400) {
      const codes: Record<string, string> = {
        periodo_invalido: "ADCLEAN_LICENSE_PERIOD_INVALID",
        email_obrigatorio: "ADCLEAN_LICENSE_EMAIL_REQUIRED",
        email_invalido: "ADCLEAN_LICENSE_EMAIL_INVALID",
      };
      throw new AdcleanLicenseError(codes[errorCode ?? ""] ?? "ADCLEAN_LICENSE_BODY_INVALID");
    }
    if (status !== 200 || !data || data.ok !== true)
      throw new AdcleanLicenseError(`ADCLEAN_LICENSE_HTTP_${status}`);

    const codigo = typeof data.codigo === "string" ? data.codigo.trim() : "";
    if (!codigo) throw new AdcleanLicenseError("ADCLEAN_LICENSE_INVALID_RESPONSE");
    const email = typeof data.email === "string" && data.email ? data.email : contract.email;
    const periodoHoras = typeof data.periodo_horas === "number" ? data.periodo_horas : contract.periodo_horas;
    return {
      externalOrderId: identity,
      reference: identity,
      status: "COMPLETED",
      delivery: {
        kind: "provider-delivery",
        deliveryType: "CODE",
        title: "Licença AdClean gerada",
        credential: codigo,
        deliveryFields: [
          { key: "code", label: "Código", value: codigo, sensitive: true },
          { key: "email", label: "E-mail da licença", value: email, sensitive: false },
          { key: "period", label: "Período", value: periodoLabel(periodoHoras), sensitive: false },
        ],
        instructions: `O AdClean enviou o código para ${email}. Use-o no aplicativo AdClean com esse mesmo e-mail.`,
        // Registro bruto para suporte manual (reenvio, conferência).
        adcleanLicense: {
          codigo,
          email,
          periodo_horas: periodoHoras,
          reconciliado: data.reconciliado === true,
        },
      },
    };
  }

  async createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult> {
    const orderId = input.payload.orderId;
    if (typeof orderId !== "string" || !orderId.trim())
      throw new AdcleanLicenseError("ADCLEAN_LICENSE_ORDER_ID_REQUIRED");
    const contract = await this.contractFor(orderId, input.providerProductId);
    try {
      return await this.generate(contract);
    } catch (error) {
      if (!(error instanceof ProviderOrderUncertainError)) throw error;
      // Uma única repetição imediata com a mesma chave: se a 1ª chegou ao
      // AdClean, volta reconciliado:true com o mesmo código.
      return this.generate(contract);
    }
  }

  // Repete /admin/gerar com a mesma chave e o mesmo corpo (reconstruído do
  // Order). O AdClean nunca gera um segundo código para a mesma chave.
  async getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult> {
    if (!externalOrderId.startsWith(IDENTITY_PREFIX))
      return { externalOrderId, status: "FAILED", error: "ADCLEAN_LICENSE_IDENTITY_INVALID" };
    const contract = await this.contractFor(externalOrderId.slice(IDENTITY_PREFIX.length));
    return this.generate(contract);
  }

  buildReconciliationIdentity(orderId: string): string {
    return adcleanLicenseIdentity(orderId);
  }

  // Reenvio do código para o e-mail gravado no AdClean (suporte manual).
  async resendCode(target: { codigo: string } | { orderId: string }): Promise<AdcleanLicenseResendResult> {
    const body =
      "codigo" in target ? { codigo: target.codigo.trim() } : { external_order_id: target.orderId.trim() };
    let res: Awaited<ReturnType<AdcleanLicenseAdapter["post"]>>;
    try {
      res = await this.post("/admin/reenviar-codigo", body);
    } catch {
      return { ok: false, retry: true, error: "ADCLEAN_LICENSE_RESEND_UNCERTAIN" };
    }
    const { status, data, errorCode } = res;
    if (status === 200 && data?.ok === true && typeof data.codigo === "string")
      return { ok: true, codigo: data.codigo, email: typeof data.email === "string" ? data.email : "" };
    if (status === 429 || status === 502 || status >= 500 || errorCode === "aguarde_reenvio" || errorCode === "falha_envio_email")
      return { ok: false, retry: true, error: `ADCLEAN_LICENSE_RESEND_${(errorCode ?? `HTTP_${status}`).toUpperCase()}` };
    return { ok: false, retry: false, error: `ADCLEAN_LICENSE_RESEND_${(errorCode ?? `HTTP_${status}`).toUpperCase()}` };
  }
}

export class AdcleanLicenseDisconnectedAdapter implements ProviderAdapter {
  readonly code = ADCLEAN_LICENSE_CODE;
  readonly supportsReconciliation = false;
  async checkConnection(): Promise<ProviderHealth> {
    return { connected: false, message: "Não conectado" };
  }
  async listProducts(): Promise<ProviderCatalogItem[]> {
    throw new ProviderNotConnectedError(this.code);
  }
  async getBalance(): Promise<ProviderBalance> {
    throw new ProviderNotConnectedError(this.code);
  }
  async createOrder(): Promise<ProviderOrderResult> {
    throw new ProviderNotConnectedError(this.code);
  }
  async getOrderStatus(): Promise<ProviderOrderResult> {
    throw new ProviderNotConnectedError(this.code);
  }
  async resendCode(): Promise<AdcleanLicenseResendResult> {
    return { ok: false, retry: false, error: "ADCLEAN_LICENSE_NOT_CONFIGURED" };
  }
}

// loadOrder: a revenda via API não tem Order; ela injeta o próprio lookup
// (e-mail do cliente final + ProviderProduct comprado, gravados no ledger).
export function configuredAdcleanLicenseAdapter(loadOrder?: OrderLookup) {
  const token = process.env.ADCLEAN_LICENSE_PARTNER_TOKEN;
  const baseUrl = process.env.ADCLEAN_BASE_URL;
  return adcleanLicenseConfigured(token, baseUrl)
    ? new AdcleanLicenseAdapter({ token: token!, baseUrl: baseUrl || ADCLEAN_DEFAULT_BASE_URL, loadOrder })
    : new AdcleanLicenseDisconnectedAdapter();
}
