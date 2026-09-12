import { describe, expect, it, vi } from "vitest";
import { HeartUnlocksProviderAdapter, ProviderOrderUncertainError } from "./heartunlocks";
import { decodeReplay, parseCredentials, callbackEventKey } from "./heartunlocks-callback";

describe("HeartUnlocks adapter", () => {
  it("reads the catalog through the authenticated gateway without creating orders", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://gateway.test/products");
      expect(init?.method).toBeUndefined();
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer test-secret");
      return new Response(JSON.stringify({ status: "success", data: { currency: "USD", products: { "2194": { name: "UNLOCKTOOL RENT [6 Hours]", price: "0.28" } } } }));
    });
    const adapter = new HeartUnlocksProviderAdapter({ gatewayUrl: "https://gateway.test", gatewaySecret: "test-secret", fetcher });
    await expect(adapter.listProducts()).resolves.toEqual([expect.objectContaining({ externalProductId: "2194", costCents: 28, currency: "USD" })]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("sends the mapped product, reference and required quantity to the gateway", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ productUuid: "2194", referenceId: "provider-order-1", quantity: 1 });
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer test-secret");
      return new Response(JSON.stringify({ externalOrderId: "hu-1", referenceId: body.referenceId, status: "PROCESSING" }), { status: 202 });
    });
    const adapter = new HeartUnlocksProviderAdapter({ gatewayUrl: "https://gateway.test", gatewaySecret: "test-secret", fetcher });
    await expect(adapter.createOrder({ providerProductId: "2194", reference: "provider-order-1", payload: { Quantity: 1 } })).resolves.toMatchObject({ externalOrderId: "hu-1", status: "PROCESSING" });
  });

  it("rejects a quantity different from one", async () => {
    const adapter = new HeartUnlocksProviderAdapter({ gatewayUrl: "https://gateway.test", gatewaySecret: "secret" });
    await expect(adapter.createOrder({ providerProductId: "2194", reference: "ref", payload: { Quantity: 2 } })).rejects.toThrow("HEARTUNLOCKS_INVALID_QUANTITY");
  });

  it("marks an aborted request as uncertain", async () => {
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const adapter = new HeartUnlocksProviderAdapter({ gatewayUrl: "https://gateway.test", gatewaySecret: "secret", fetcher, timeoutMs: 1 });
    await expect(adapter.createOrder({ providerProductId: "2194", reference: "ref", payload: { Quantity: 1 } })).rejects.toBeInstanceOf(ProviderOrderUncertainError);
  });

  it("marks a gateway 5xx result as uncertain instead of allowing a blind retry", async () => {
    const adapter = new HeartUnlocksProviderAdapter({ gatewayUrl: "https://gateway.test", gatewaySecret: "secret", fetcher: vi.fn(async () => new Response("upstream error", { status: 502 })) });
    await expect(adapter.createOrder({ providerProductId: "2194", reference: "ref", payload: { Quantity: 1 } })).rejects.toBeInstanceOf(ProviderOrderUncertainError);
  });
});

describe("HeartUnlocks callback replay", () => {
  it("decodes credentials using documented and tolerated labels", () => {
    expect(parseCredentials(decodeReplay(Buffer.from("USERNAME=> tech\nPASSWORD=> safe-pass").toString("base64")))).toEqual({ username: "tech", password: "safe-pass" });
    expect(parseCredentials(decodeReplay(Buffer.from("LOGIN: tech2\nPASS: pass2").toString("base64")))).toEqual({ username: "tech2", password: "pass2" });
  });
  it("rejects invalid replay and does not invent credentials", () => {
    expect(decodeReplay("not base64!")) .toBeNull();
    expect(parseCredentials("arbitrary provider response")).toBeNull();
  });
  it("produces a stable idempotency key and changes it with the event", () => {
    const event = { reference_id: "ref", order_id: "order", status: "success", replay: "abc=" };
    expect(callbackEventKey(event)).toBe(callbackEventKey(event));
    expect(callbackEventKey(event)).not.toBe(callbackEventKey({ ...event, status: "rejected" }));
  });
});
