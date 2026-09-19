export type ProviderHealth = { connected: boolean; message: string };
export type ProviderCatalogItem = {
  externalProductId: string;
  label: string;
  costCents?: number;
  currency?: string;
  providerTime?: string | null;
  type?: string | null;
  status?: string | null;
  requiredFields?: Array<{
    name: string;
    type: string | null;
    required: boolean | null;
    base: boolean | null;
  }>;
  metadata?: Record<string, unknown>;
};
export type ProviderBalance = { amountCents: number; currency: string };
export type ProviderOrderInput = {
  providerProductId: string;
  reference: string;
  payload: Record<string, unknown>;
};
export type ProviderOrderResult = {
  externalOrderId?: string;
  status: "COMPLETED" | "PROCESSING" | "FAILED";
  reference?: string;
  delivery?: Record<string, unknown>;
  error?: string;
};

export interface ProviderAdapter {
  readonly code: string;
  // Capability explícita: só o motor de reconciliação pode chamar getOrderStatus
  // quando isto for true. Um adapter sem contrato real de consulta (ex.:
  // HeartUnlocks, que confirma via callback) deve declarar false em vez de
  // deixar o motor genérico descobrir isso por tentativa e erro.
  readonly supportsReconciliation: boolean;
  checkConnection(): Promise<ProviderHealth>;
  listProducts(): Promise<ProviderCatalogItem[]>;
  getBalance(): Promise<ProviderBalance>;
  createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult>;
  // Capability OPCIONAL: quando o provider deriva sua própria identidade de
  // consulta deterministicamente a partir do orderId (ex.: AdClean sempre usa
  // `bancadasoft:<orderId>` como idempotency_key, com ou sem confirmação
  // prévia — ver adclean-contract.ts), o adapter expõe essa derivação aqui.
  // O motor genérico NUNCA reconstrói identidade de provider nenhum sozinho
  // (nunca fica sabendo do formato "bancadasoft:") — só usa isto como
  // fallback quando ProviderOrder.externalOrderId ainda não foi confirmado.
  // Ausente = provider não tem forma segura de reconstruir a identidade sem
  // confirmação prévia; reconciliação sem externalOrderId permanece
  // RECONCILIATION_IDENTITY_UNKNOWN para esse provider.
  buildReconciliationIdentity?(orderId: string): string;
}

export class ProviderNotConnectedError extends Error {
  constructor(code: string) {
    super(`Provider ${code} não conectado.`);
    this.name = "ProviderNotConnectedError";
  }
}

export class ProviderOrderUncertainError extends Error {
  constructor() {
    super("PROVIDER_RESULT_UNCERTAIN");
    this.name = "ProviderOrderUncertainError";
  }
}

export class ProviderReconciliationRequiredError extends Error {
  constructor(public readonly reason: string) {
    super(`PROVIDER_RECONCILIATION_REQUIRED:${reason}`);
    this.name = "ProviderReconciliationRequiredError";
  }
}
