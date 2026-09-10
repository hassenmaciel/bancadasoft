import type { ProviderAdapter, ProviderBalance, ProviderCatalogItem, ProviderHealth, ProviderOrderInput, ProviderOrderResult } from "./types";

export type MockOutcome = "SUCCESS" | "PROCESSING" | "FAILURE";
export class MockProviderAdapter implements ProviderAdapter {
  readonly code = "mock-sandbox";
  constructor(private readonly outcome: MockOutcome = "SUCCESS") {}
  async checkConnection(): Promise<ProviderHealth> { return { connected: true, message: "Sandbox disponível" }; }
  async listProducts(): Promise<ProviderCatalogItem[]> { return []; }
  async getBalance(): Promise<ProviderBalance> { return { amountCents: 0, currency: "BRL" }; }
  async createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult> {
    if (this.outcome === "FAILURE") return { externalOrderId: `mock-${input.reference}`, status: "FAILED", error: "Falha controlada do sandbox." };
    if (this.outcome === "PROCESSING") return { externalOrderId: `mock-${input.reference}`, status: "PROCESSING" };
    return { externalOrderId: `mock-${input.reference}`, status: "COMPLETED", delivery: { credential: `MOCK-${input.reference.slice(0, 8).toUpperCase()}`, instructions: "Entrega MOCK/TESTE. Nenhuma licença real foi emitida." } };
  }
  async getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult> { return { externalOrderId, status: this.outcome === "SUCCESS" ? "COMPLETED" : this.outcome === "FAILURE" ? "FAILED" : "PROCESSING" }; }
}
