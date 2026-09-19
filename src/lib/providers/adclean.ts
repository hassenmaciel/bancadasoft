import { adcleanIdempotencyKey, buildAdcleanTicketContract } from "./adclean-contract";
import type {
  ProviderAdapter,
  ProviderBalance,
  ProviderCatalogItem,
  ProviderHealth,
  ProviderOrderInput,
  ProviderOrderResult,
} from "./types";
import {
  ProviderNotConnectedError,
  ProviderOrderUncertainError,
  ProviderReconciliationRequiredError,
} from "./types";

export const ADCLEAN_CODE = "adclean";
export const ADCLEAN_TICKET_PRODUCT_ID = "ticket-168h";
export const ADCLEAN_DEFAULT_BASE_URL =
  "https://repair-adclean-licenca.adclean-ha100.workers.dev";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type Sleeper = (milliseconds: number) => Promise<void>;
type AdcleanResponse =
  | { kind: "CODE"; code: string }
  | { kind: "PROCESSING" }
  | { kind: "NOT_FOUND" };

export class AdcleanProviderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AdcleanProviderError";
  }
}

export function normalizeAdcleanBaseUrl(value = ADCLEAN_DEFAULT_BASE_URL) {
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("ADCLEAN_BASE_URL_INVALID");
  return url.origin;
}

export function adcleanConfigured(
  token = process.env.ADCLEAN_PARTNER_TOKEN,
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

const defaultSleep: Sleeper = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AdcleanProviderAdapter implements ProviderAdapter {
  readonly code = ADCLEAN_CODE;
  readonly supportsReconciliation = true;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(
    private readonly options: {
      token: string;
      baseUrl?: string;
      fetcher?: Fetcher;
      sleep?: Sleeper;
      timeoutMs?: number;
    },
  ) {
    this.token = options.token.trim();
    if (!this.token) throw new Error("ADCLEAN_PARTNER_TOKEN_MISSING");
    this.baseUrl = normalizeAdcleanBaseUrl(
      options.baseUrl || ADCLEAN_DEFAULT_BASE_URL,
    );
  }

  async checkConnection(): Promise<ProviderHealth> {
    return { connected: true, message: "Configuração AdClean disponível" };
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    return [];
  }

  async getBalance(): Promise<ProviderBalance> {
    throw new Error("ADCLEAN_BALANCE_NOT_SUPPORTED");
  }

  private async post(
    path: "/admin/gerar-ticket" | "/admin/consultar-ticket",
    body: Record<string, unknown>,
  ): Promise<AdcleanResponse> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 10_000,
    );
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

    const data = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const errorCode = typeof data?.erro === "string" ? data.erro : null;
    if (
      response.status === 409 &&
      errorCode === "idempotency_processando_tente_novamente"
    )
      return { kind: "PROCESSING" };
    if (response.status === 409 && errorCode === "idempotency_conflict")
      throw new ProviderReconciliationRequiredError(
        "ADCLEAN_IDEMPOTENCY_CONFLICT",
      );
    if (response.status === 401 || errorCode === "nao_autorizado")
      throw new AdcleanProviderError("ADCLEAN_NOT_AUTHORIZED");
    if (response.status === 400 || errorCode === "body_invalido")
      throw new AdcleanProviderError(
        errorCode === "idempotency_key_invalida"
          ? "ADCLEAN_IDEMPOTENCY_KEY_INVALID"
          : "ADCLEAN_BODY_INVALID",
      );
    if (!response.ok) {
      if (response.status >= 500) throw new ProviderOrderUncertainError();
      throw new AdcleanProviderError(`ADCLEAN_HTTP_${response.status}`);
    }
    if (!data || data.ok !== true)
      throw new AdcleanProviderError("ADCLEAN_INVALID_RESPONSE");
    if (typeof data.codigo === "string" && data.codigo.trim())
      return { kind: "CODE", code: data.codigo.trim() };
    if (data.processando === true) return { kind: "PROCESSING" };
    if (path === "/admin/consultar-ticket" && data.encontrado === false)
      return { kind: "NOT_FOUND" };
    throw new AdcleanProviderError("ADCLEAN_INVALID_RESPONSE");
  }

  private generate(contract: ReturnType<typeof buildAdcleanTicketContract>) {
    return this.post("/admin/gerar-ticket", contract);
  }

  private consult(idempotencyKey: string) {
    return this.post("/admin/consultar-ticket", {
      idempotency_key: idempotencyKey,
    });
  }

  private completed(code: string, idempotencyKey: string): ProviderOrderResult {
    return {
      externalOrderId: idempotencyKey,
      reference: idempotencyKey,
      status: "COMPLETED",
      delivery: {
        kind: "provider-delivery",
        deliveryType: "CODE",
        title: "Código AdClean liberado",
        credential: code,
        deliveryFields: [
          {
            key: "code",
            label: "Código",
            value: code,
            sensitive: true,
          },
        ],
        instructions: "Copie o código e utilize-o no fluxo oficial do AdClean.",
      },
    };
  }

  private async afterProcessing(idempotencyKey: string) {
    await (this.options.sleep ?? defaultSleep)(300);
    const reconciled = await this.consult(idempotencyKey);
    if (reconciled.kind === "CODE")
      return this.completed(reconciled.code, idempotencyKey);
    return {
      externalOrderId: idempotencyKey,
      reference: idempotencyKey,
      status: "PROCESSING" as const,
    };
  }

  private async handleGeneration(
    result: AdcleanResponse,
    idempotencyKey: string,
  ) {
    if (result.kind === "CODE")
      return this.completed(result.code, idempotencyKey);
    if (result.kind === "PROCESSING")
      return this.afterProcessing(idempotencyKey);
    throw new AdcleanProviderError("ADCLEAN_INVALID_GENERATION_RESPONSE");
  }

  private async recoverUncertain(
    contract: ReturnType<typeof buildAdcleanTicketContract>,
  ): Promise<ProviderOrderResult> {
    const reconciled = await this.consult(contract.idempotency_key);
    if (reconciled.kind === "CODE")
      return this.completed(reconciled.code, contract.idempotency_key);
    if (reconciled.kind === "PROCESSING")
      return this.afterProcessing(contract.idempotency_key);

    try {
      return await this.handleGeneration(
        await this.generate(contract),
        contract.idempotency_key,
      );
    } catch (error) {
      if (!(error instanceof ProviderOrderUncertainError)) throw error;
      const finalCheck = await this.consult(contract.idempotency_key);
      if (finalCheck.kind === "CODE")
        return this.completed(finalCheck.code, contract.idempotency_key);
      throw new ProviderOrderUncertainError();
    }
  }

  async createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult> {
    const orderId = input.payload.orderId;
    const paidAmountCents = input.payload.paidAmountCents;
    if (typeof orderId !== "string")
      throw new AdcleanProviderError("ADCLEAN_ORDER_ID_REQUIRED");
    if (
      typeof paidAmountCents !== "number" ||
      !Number.isInteger(paidAmountCents)
    )
      throw new AdcleanProviderError("ADCLEAN_PAID_AMOUNT_REQUIRED");
    const contract = buildAdcleanTicketContract(orderId, paidAmountCents);
    try {
      return await this.handleGeneration(
        await this.generate(contract),
        contract.idempotency_key,
      );
    } catch (error) {
      if (!(error instanceof ProviderOrderUncertainError)) throw error;
      return this.recoverUncertain(contract);
    }
  }

  async getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult> {
    const result = await this.consult(externalOrderId);
    if (result.kind === "CODE")
      return this.completed(result.code, externalOrderId);
    if (result.kind === "PROCESSING")
      return {
        externalOrderId,
        reference: externalOrderId,
        status: "PROCESSING",
      };
    return {
      externalOrderId,
      reference: externalOrderId,
      status: "FAILED",
      error: "ADCLEAN_TICKET_NOT_FOUND",
    };
  }

  // idempotency_key é sempre bancadasoft:<orderId> — mesma função pura já
  // usada por createOrder() via buildAdcleanTicketContract, com ou sem
  // confirmação prévia do provider. Reconciliação pode reconstruir essa
  // identidade com segurança mesmo quando ProviderOrder.externalOrderId
  // nunca chegou a ser gravado (ex.: falha de rede antes de qualquer
  // resposta do AdClean).
  buildReconciliationIdentity(orderId: string): string {
    return adcleanIdempotencyKey(orderId);
  }
}

export class AdcleanDisconnectedAdapter implements ProviderAdapter {
  readonly code = ADCLEAN_CODE;
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
}

export function configuredAdcleanAdapter() {
  const token = process.env.ADCLEAN_PARTNER_TOKEN;
  const baseUrl = process.env.ADCLEAN_BASE_URL;
  return adcleanConfigured(token, baseUrl)
    ? new AdcleanProviderAdapter({
        token: token!,
        baseUrl: baseUrl || ADCLEAN_DEFAULT_BASE_URL,
      })
    : new AdcleanDisconnectedAdapter();
}
