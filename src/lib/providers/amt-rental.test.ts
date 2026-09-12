import { ProductStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { isPublicProduct } from "../catalog";
import {
  needsGuestCheckoutRecovery,
  parseSavedCheckoutReference,
} from "../checkout-recovery";
import {
  MAX_PROVIDER_ATTEMPTS,
  validateProviderExecution,
} from "../fulfillment-rules";
import { deliveryEmailContent } from "../notifications/delivery-email";
import {
  callbackEventKey,
  credentialDelivery,
  decodeReplay,
  parseCredentials,
} from "./heartunlocks-callback";
import {
  HeartUnlocksProviderAdapter,
  ProviderOrderUncertainError,
} from "./heartunlocks";
import { resolveProviderProduct } from "./selection";

const amtProviderProduct = {
  id: "provider-product-amt",
  productId: "product-amt",
  externalProductId: "2337",
  active: true,
  mode: "REAL" as const,
  providerCostCents: 35,
  provider: {
    id: "provider-heartunlocks",
    code: "heartunlocks",
    active: true,
  },
};

describe("AMT 2h automated rental", () => {
  it("selects HeartUnlocks ProviderProduct 2337 in REAL mode", () => {
    expect(resolveProviderProduct([amtProviderProduct], "REAL")).toMatchObject({
      status: "SELECTED",
      providerProduct: {
        externalProductId: "2337",
        providerCostCents: 35,
      },
    });
  });

  it("reuses the quantity-only adapter with Quantity 1 and a stable reference", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        productUuid: "2337",
        referenceId: "provider-order-amt",
        quantity: 1,
        fields: {},
      });
      return new Response(
        JSON.stringify({
          externalOrderId: "external-amt-test",
          referenceId: "provider-order-amt",
          status: "PROCESSING",
        }),
        { status: 202 },
      );
    });
    const adapter = new HeartUnlocksProviderAdapter({
      gatewayUrl: "https://gateway.example.test",
      gatewaySecret: "test-secret",
      fetcher,
    });
    await expect(
      adapter.createOrder({
        providerProductId: "2337",
        reference: "provider-order-amt",
        payload: { Quantity: 1 },
      }),
    ).resolves.toMatchObject({ status: "PROCESSING" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("parses fictitious AMT credentials and creates product-aware delivery", () => {
    const replay = Buffer.from(
      "Login: AmtTestUser<br/>Password: Amt-Test-Pass!",
    ).toString("base64");
    const credentials = parseCredentials(decodeReplay(replay));
    expect(credentials).toEqual({
      username: "AmtTestUser",
      password: "Amt-Test-Pass!",
    });
    expect(
      credentialDelivery(credentials!, {
        name: "Android Multi Tool — Aluguel 2 horas",
      }),
    ).toMatchObject({
      title: "Android Multi Tool — Aluguel 2 horas",
      username: "AmtTestUser",
      password: "Amt-Test-Pass!",
    });
  });

  it("keeps duplicate callbacks idempotent", () => {
    const event = {
      reference_id: "provider-order-amt",
      order_id: "external-amt-test",
      status: "success",
      replay: "fictitious-base64-replay",
    };
    expect(callbackEventKey(event)).toBe(callbackEventKey(event));
    expect(new Set([callbackEventKey(event), callbackEventKey(event)]).size).toBe(1);
  });

  it("does not allow a blind retry after an uncertain provider result", () => {
    expect(
      validateProviderExecution(
        {
          orderExists: true,
          paymentStatus: "PAID",
          orderStatus: "PROCESSING",
          hasProviderProduct: true,
          providerActive: true,
          providerConnected: true,
          providerOrderStatus: "FAILED",
          attempts: 1,
          hasDelivery: false,
          requestReference: "provider-order-amt",
          resultUncertain: true,
        },
        true,
      ),
    ).toBe("RECONCILIATION_REQUIRED");
    expect(MAX_PROVIDER_ATTEMPTS).toBeGreaterThan(1);
  });

  it("marks an AMT timeout after POST as uncertain", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const adapter = new HeartUnlocksProviderAdapter({
      gatewayUrl: "https://gateway.example.test",
      gatewaySecret: "test-secret",
      fetcher,
      timeoutMs: 1,
    });
    await expect(
      adapter.createOrder({
        providerProductId: "2337",
        reference: "provider-order-amt",
        payload: { Quantity: 1 },
      }),
    ).rejects.toBeInstanceOf(ProviderOrderUncertainError);
  });

  it("recovers the same guest checkout reference after reload", () => {
    const token = "amt-recovery-token-with-at-least-32-characters";
    const reference = parseSavedCheckoutReference(
      JSON.stringify({
        id: "order-amt",
        publicToken: "public-amt",
        deliveryAccessToken: token,
      }),
    );
    expect(reference).toMatchObject({ id: "order-amt" });
    expect(needsGuestCheckoutRecovery(reference!)).toBe(false);
  });

  it("keeps DRAFT AMT private and sends only a secure delivery link by email", () => {
    expect(
      isPublicProduct({ status: ProductStatus.DRAFT, available: true }),
    ).toBe(false);
    const content = deliveryEmailContent({
      customerName: "Cliente Teste",
      orderNumber: "AMTTEST",
      productName: "Android Multi Tool — Aluguel 2 horas",
      recipientEmail: "cliente@example.test",
      secureUrl:
        "https://www.bancadasoft.com.br/acompanhar/order-amt#token=test-token",
    });
    expect(`${content.subject}${content.html}${content.text}`).toContain(
      "Android Multi Tool",
    );
    expect(`${content.html}${content.text}`).toContain("/acompanhar/order-amt#token=");
    expect(`${content.html}${content.text}`).not.toMatch(/AmtTestUser|Amt-Test-Pass/);
  });
});
