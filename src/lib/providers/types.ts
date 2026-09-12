export type ProviderHealth = { connected: boolean; message: string };
export type ProviderCatalogItem = {
  externalProductId: string;
  label: string;
  costCents?: number;
  currency?: string;
  providerTime?: string | null;
  type?: string | null;
  status?: string | null;
  requiredFields?: Array<{ name: string; type: string | null; required: boolean | null; base: boolean | null }>;
  metadata?: Record<string, unknown>;
};
export type ProviderBalance = { amountCents: number; currency: string };
export type ProviderOrderInput = { providerProductId: string; reference: string; payload: Record<string, unknown> };
export type ProviderOrderResult = { externalOrderId?: string; status: "COMPLETED" | "PROCESSING" | "FAILED"; reference?: string; delivery?: Record<string, unknown>; error?: string };

export interface ProviderAdapter {
  readonly code: string;
  checkConnection(): Promise<ProviderHealth>;
  listProducts(): Promise<ProviderCatalogItem[]>;
  getBalance(): Promise<ProviderBalance>;
  createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult>;
  getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult>;
}

export class ProviderNotConnectedError extends Error {
  constructor(code: string) { super(`Provider ${code} não conectado.`); this.name = "ProviderNotConnectedError"; }
}
