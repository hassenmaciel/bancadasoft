import { describe, expect, it } from "vitest";
import { HeartUnlocksDisconnectedAdapter, HEARTUNLOCKS_API_BASE_URL } from "./heartunlocks";
import { resolveProviderProduct, selectProviderProduct, type ProviderProductCandidate } from "./selection";

const candidate = (input: Partial<ProviderProductCandidate> = {}): ProviderProductCandidate => ({
  id: "link-1", productId: "internal-product-1", externalProductId: "external-service-10",
  active: true, mode: "TEST", providerCostCents: 1000, provider: { id: "provider-1", code: "mock-sandbox", active: true }, ...input,
});

describe("ProviderAdapter", () => {
  it("representa HeartUnlocks sem conexão e sem realizar HTTP", async () => {
    const adapter = new HeartUnlocksDisconnectedAdapter();
    await expect(adapter.checkConnection()).resolves.toEqual({ connected: false, message: "Não conectado" });
    await expect(adapter.listProducts()).rejects.toThrow("não conectado");
    expect(HEARTUNLOCKS_API_BASE_URL).toBe("https://api.heartunlocks.com");
  });
});

describe("seleção determinística de ProviderProduct", () => {
  it("seleciona o único vínculo ativo do modo solicitado", () => {
    const selected = selectProviderProduct([candidate()], "TEST");
    expect(selected).toMatchObject({ productId: "internal-product-1", externalProductId: "external-service-10" });
  });
  it("isola mock TEST do fornecedor REAL", () => {
    const testLink = candidate({ id: "mock", mode: "TEST" });
    const realLink = candidate({ id: "heart", mode: "REAL", externalProductId: "2194", provider: { id: "heart-provider", code: "heartunlocks", active: true } });
    expect(selectProviderProduct([testLink, realLink], "REAL")?.id).toBe("heart");
    expect(selectProviderProduct([testLink, realLink], "TEST")?.id).toBe("mock");
  });
  it("falha fechado sem vínculo elegível", () => {
    expect(resolveProviderProduct([candidate({ active: false })], "TEST").status).toBe("MISSING");
    expect(resolveProviderProduct([candidate({ provider: { id: "provider-1", code: "mock-sandbox", active: false } })], "TEST").status).toBe("MISSING");
  });
  it("nunca seleciona sandbox no modo REAL, mesmo se estiver configurado incorretamente", () => {
    const sandbox = candidate({ mode: "REAL", provider: { id: "sandbox", code: "mock-sandbox", active: true } });
    const heart = candidate({ id: "heart", mode: "REAL", externalProductId: "2194", provider: { id: "heart-provider", code: "heartunlocks", active: true } });
    expect(resolveProviderProduct([sandbox, heart], "REAL")).toMatchObject({ status: "SELECTED", providerProduct: { id: "heart" } });
    expect(resolveProviderProduct([sandbox], "REAL").status).toBe("MISSING");
  });
  it("não escolhe silenciosamente entre dois vínculos elegíveis", () => {
    expect(resolveProviderProduct([candidate({ id: "one" }), candidate({ id: "two" })], "TEST").status).toBe("AMBIGUOUS");
  });
});
