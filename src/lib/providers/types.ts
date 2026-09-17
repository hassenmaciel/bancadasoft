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
