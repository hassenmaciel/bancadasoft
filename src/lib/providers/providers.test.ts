import { describe, expect, it } from "vitest";
import { HeartUnlocksDisconnectedAdapter, HEARTUNLOCKS_API_BASE_URL } from "./heartunlocks";
import { selectProviderProduct, type ProviderProductCandidate } from "./selection";

const candidate = (input: Partial<ProviderProductCandidate> = {}): ProviderProductCandidate => ({
  id: "link-1", productId: "internal-product-1", externalProductId: "external-service-10",
  active: true, providerCostCents: 1000, provider: { id: "provider-1", active: true }, ...input,
});

describe("ProviderAdapter", () => {
  it("representa HeartUnlocks sem conexão e sem realizar HTTP", async () => {
    const adapter = new HeartUnlocksDisconnectedAdapter();
    await expect(adapter.checkConnection()).resolves.toEqual({ connected: false, message: "Não conectado" });
    await expect(adapter.listProducts()).rejects.toThrow("não conectado");
    expect(HEARTUNLOCKS_API_BASE_URL).toBe("https://api.heartunlocks.com");
  });
});

describe("seleção de ProviderProduct", () => {
  it("mantém separados o produto interno e o identificador externo", () => {
    const selected = selectProviderProduct([candidate()]);
    expect(selected?.productId).toBe("internal-product-1");
    expect(selected?.externalProductId).toBe("external-service-10");
  });
  it("ignora vínculos e providers inativos", () => {
    expect(selectProviderProduct([candidate({ active: false })])).toBeNull();
    expect(selectProviderProduct([candidate({ provider: { id: "provider-1", active: false } })])).toBeNull();
  });
  it("prefere o vínculo ativo de menor custo conhecido", () => {
    const selected = selectProviderProduct([candidate({ id: "expensive", providerCostCents: 2000 }), candidate({ id: "economical", providerCostCents: 900 })]);
    expect(selected?.id).toBe("economical");
  });
});
