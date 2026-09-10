import type { ProviderAdapter, ProviderBalance, ProviderCatalogItem, ProviderHealth, ProviderOrderInput, ProviderOrderResult } from "./types";
import { ProviderNotConnectedError } from "./types";

export const HEARTUNLOCKS_CODE = "heartunlocks";
export const HEARTUNLOCKS_API_BASE_URL = "https://api.heartunlocks.com";

export class HeartUnlocksDisconnectedAdapter implements ProviderAdapter {
  readonly code = HEARTUNLOCKS_CODE;
  async checkConnection(): Promise<ProviderHealth> { return { connected: false, message: "Não conectado" }; }
  async listProducts(): Promise<ProviderCatalogItem[]> { throw new ProviderNotConnectedError(this.code); }
  async getBalance(): Promise<ProviderBalance> { throw new ProviderNotConnectedError(this.code); }
  async createOrder(_input: ProviderOrderInput): Promise<ProviderOrderResult> { throw new ProviderNotConnectedError(this.code); }
  async getOrderStatus(_externalOrderId: string): Promise<ProviderOrderResult> { throw new ProviderNotConnectedError(this.code); }
}
