import { describe, expect, it, vi } from "vitest";
import { AsaasPaymentProvider } from "./asaas";
import { AsaasClient } from "./asaas-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const build = (fetcher: typeof fetch) => new AsaasPaymentProvider(new AsaasClient("fake-key-for-tests", { fetcher }));

describe("AsaasPaymentProvider.cancelPayment", () => {
  it("envia um único DELETE e retorna CANCELLED", async () => {
    const fetcher = vi.fn(async () => json({ deleted: true, id: "pay_fake" }));
    await expect(build(fetcher as never).cancelPayment("pay_fake")).resolves.toBe("CANCELLED");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/payments/pay_fake")).toBe(true);
    expect(init.method).toBe("DELETE");
  });
  it("404 é idempotente: ALREADY_GONE", async () => {
    const fetcher = vi.fn(async () => json({ errors: [{ code: "invalid_object" }] }, 404));
    await expect(build(fetcher as never).cancelPayment("pay_fake")).resolves.toBe("ALREADY_GONE");
  });
  it("400 é recusa definitiva: REJECTED, sem retry", async () => {
    const fetcher = vi.fn(async () => json({ errors: [{ code: "invalid_action" }] }, 400));
    await expect(build(fetcher as never).cancelPayment("pay_fake")).resolves.toBe("REJECTED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([500, 503, 429])("erro ambíguo %s vira UNCERTAIN e não é repetido", async (status) => {
    const fetcher = vi.fn(async () => json({}, status));
    await expect(build(fetcher as never).cancelPayment("pay_fake")).resolves.toBe("UNCERTAIN");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("falha de rede vira UNCERTAIN sem retry", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(build(fetcher as never).cancelPayment("pay_fake")).resolves.toBe("UNCERTAIN");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
