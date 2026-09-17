import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// TESTE DE INTEGRAÇÃO (seção 22 da tarefa "fechamento definitivo do fluxo
// pós-pagamento guest") — atravessa módulos reais (não só funções isoladas):
//
//   fulfillment-engine.ts (executeFulfillment/reconcileFulfillment, REAIS)
//   -> Fulfillment.delivery (JSON real produzido pelo adapter AdClean mockado)
//   -> customer-delivery.ts (customerDelivery, REAL)
//   -> dto.ts (orderDto, REAL)
//
// Isso prova, sem precisar de infraestrutura de renderização de componentes
// (que este projeto não usa em nenhum teste existente — ver
// product-card-media.test.ts, que testa CSS estático, não um componente
// renderizado), que o JSON que chega ao CredentialDelivery é exatamente o que
// o componente espera para CODE, e que o endpoint público nunca vaza esse
// JSON enquanto o endpoint de entrega o expõe corretamente.
//
// Zero chamadas reais a AdClean/Asaas/HeartUnlocks.

const db = vi.hoisted(() => ({
  order: { findUnique: vi.fn(), update: vi.fn() },
  siteSettings: { findUnique: vi.fn() },
  fulfillment: { upsert: vi.fn(), update: vi.fn() },
  providerOrder: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  provider: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { executeFulfillment, reconcileFulfillment } from "./fulfillment-engine";
import { customerDelivery } from "./customer-delivery";
import { orderDto } from "./dto";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const adcleanProviderProduct = {
  id: "provider-product-adclean-ticket-168h",
  providerId: "provider-adclean-v2",
  externalProductId: "ticket-168h",
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  providerCostCents: null,
  currency: "BRL",
  fieldSchema: null,
  provider: { id: "provider-adclean-v2", code: "adclean", active: true, integrationStatus: "NOT_CONNECTED" },
};

const fakeProduct = {
  id: "product-adclean",
  slug: "adclean",
  name: "Repair AdClean — Ticket de Acesso",
  description: "",
  longDescription: null,
  type: "TOOL",
  deliveryType: "AUTOMATIC",
  deliveryEstimate: null,
  duration: "168 horas",
  imageUrl: null,
  downloadUrl: "https://ferramenta.example.test",
  downloadLabel: "ACESSAR FERRAMENTA",
  status: "PUBLISHED",
  available: true,
};

function engineOrder(overrides: { id: string; fulfillment: unknown }) {
  return {
    id: overrides.id,
    status: "PAID",
    payment: { status: "PAID" },
    fulfillment: overrides.fulfillment,
    items: [
      {
        unitPriceCents: 2000,
        providerFields: {},
        providerProduct: adcleanProviderProduct,
        product: { providerProducts: [] },
      },
    ],
  };
}

// Formato aceito por orderDto (guest-facing) — simula o que getOrder()
// realmente devolveria depois que executeFulfillment/reconcileFulfillment
// persistiram Fulfillment.delivery.
function dtoOrder(id: string, deliveryJson: unknown) {
  return {
    id,
    publicToken: "public-token-integration",
    status: "DELIVERED",
    totalCents: 2000,
    createdAt: new Date("2026-09-17T01:30:00Z"),
    items: [
      {
        id: "item-1",
        unitPriceCents: 2000,
        productVariant: null,
        product: fakeProduct,
      },
    ],
    payment: { status: "PAID", amountCents: 2000, externalPaymentId: "ext-1", pixCode: "00020126...", qrCode: null, expiresAt: new Date() },
    fulfillment: { status: "FULFILLED", delivery: deliveryJson },
    events: [],
  };
}

describe("INTEGRAÇÃO — checkout guest AdClean: PAID -> fulfillment real -> Delivery -> DTOs reais", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.ADCLEAN_PARTNER_TOKEN = "isolated-test-token";
    process.env.ADCLEAN_BASE_URL = "https://adclean.example.test";
    db.siteSettings.findUnique.mockResolvedValue({ providerMode: "REAL" });
    db.$transaction.mockImplementation(async (arg) =>
      typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]),
    );
    db.fulfillment.upsert.mockResolvedValue({ id: "fulfillment-int-1" });
    db.provider.findUnique.mockResolvedValue({ active: true });
    db.order.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ADCLEAN_PARTNER_TOKEN;
    delete process.env.ADCLEAN_BASE_URL;
  });

  it("happy path: gerar-ticket imediato -> Fulfillment.delivery real -> customerDelivery() reconhece CODE -> endpoint público nunca vaza, endpoint de entrega expõe", async () => {
    db.order.findUnique.mockResolvedValue(engineOrder({ id: "order-int-1", fulfillment: null }));
    db.providerOrder.upsert.mockResolvedValue({ id: "provider-order-int-1" });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    let persistedDelivery: unknown = null;
    db.fulfillment.update.mockImplementation(async ({ data }: { data: { delivery: unknown } }) => {
      persistedDelivery = data.delivery;
      return {};
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ ok: true, codigo: "TEST-INTEGRATION-001" }))),
    );

    const result = await executeFulfillment("order-int-1", { retry: false });
    expect(result).toEqual({ status: "COMPLETED" });
    expect(persistedDelivery).not.toBeNull();

    // customer-delivery.ts é o MESMO parser usado por /api/orders/[id]/delivery
    // antes de mandar o payload para <CredentialDelivery {...delivery} />.
    const parsed = customerDelivery(persistedDelivery);
    expect(parsed).toEqual({
      deliveryType: "CODE",
      title: "Código AdClean liberado",
      credential: "TEST-INTEGRATION-001",
      instructions: "Copie o código e utilize-o no fluxo oficial do AdClean.",
      deliveryFields: [{ key: "code", label: "Código", value: "TEST-INTEGRATION-001", sensitive: true }],
    });

    // Endpoint público (status/polling, guest sem sessão): NUNCA inclui Delivery.
    const publicDto = orderDto(dtoOrder("order-int-1", persistedDelivery), { includeDelivery: false });
    expect(publicDto.fulfillment?.delivery).toBeUndefined();
    expect(JSON.stringify(publicDto)).not.toContain("TEST-INTEGRATION-001");
    // downloadUrl/downloadLabel do produto continuam disponíveis para o CTA
    // "ACESSAR FERRAMENTA" mesmo no DTO público (não são sensíveis).
    expect(publicDto.items[0]?.product.downloadUrl).toBe("https://ferramenta.example.test");
    expect(publicDto.items[0]?.product.downloadLabel).toBe("ACESSAR FERRAMENTA");

    // Endpoint de entrega (Bearer deliveryAccessToken validado, ver
    // src/app/api/orders/[id]/delivery/route.ts): expõe o Delivery real, que
    // customerDelivery() converte para o mesmo formato acima.
    const secureDto = orderDto(dtoOrder("order-int-1", persistedDelivery), { includeDelivery: true });
    expect(customerDelivery(secureDto.fulfillment?.delivery)).toEqual(parsed);
  });

  it("caminho processando -> reconciliation real -> mesma convergência para CODE, sem segundo gerar-ticket", async () => {
    let persistedDelivery: unknown = null;
    db.fulfillment.update.mockImplementation(async ({ data }: { data: { delivery: unknown } }) => {
      persistedDelivery = data.delivery;
      return {};
    });
    db.providerOrder.updateMany.mockResolvedValue({ count: 1 });
    db.order.findUnique.mockResolvedValue(
      engineOrder({
        id: "order-int-2",
        fulfillment: {
          delivery: null,
          providerOrders: [
            {
              id: "provider-order-int-2",
              status: "PROCESSING",
              attempts: 1,
              requestReference: "provider-order-int-2",
              externalOrderId: "bancadasoft:order-int-2",
              lastError: "PROVIDER_RESULT_UNCERTAIN",
              callbackEvents: [],
            },
          ],
        },
      }),
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url.includes("gerar-ticket") ? "gerar" : "consultar");
        return Promise.resolve(jsonResponse({ ok: true, codigo: "TEST-INTEGRATION-002" }));
      }),
    );

    const result = await reconcileFulfillment("order-int-2");
    expect(result).toEqual({ status: "COMPLETED" });
    expect(calls).toEqual(["consultar"]); // nunca gerar-ticket

    const parsed = customerDelivery(persistedDelivery);
    expect(parsed?.deliveryType).toBe("CODE");
    expect(parsed?.credential).toBe("TEST-INTEGRATION-002");

    const publicDto = orderDto(dtoOrder("order-int-2", persistedDelivery), { includeDelivery: false });
    expect(publicDto.fulfillment?.delivery).toBeUndefined();
  });
});
