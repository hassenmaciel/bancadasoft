import { beforeEach, describe, expect, it, vi } from "vitest";

const { attemptAutomaticGuestRecovery } = vi.hoisted(() => ({
  attemptAutomaticGuestRecovery: vi.fn(),
}));
const db = vi.hoisted(() => ({
  deliveryAccessAttempt: { count: vi.fn(), create: vi.fn() },
  order: { findUnique: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/customer-delivery", async () =>
  import("../../../../../lib/customer-delivery"),
);
vi.mock("@/lib/guest-delivery", () => ({
  DELIVERY_RATE_LIMIT: 10,
  DELIVERY_RATE_WINDOW_MS: 300000,
  deliveryAccessFingerprint: vi.fn(() => "safe-fingerprint"),
  deliveryTokenMatches: vi.fn(() => true),
}));
vi.mock("@/lib/fulfillment-engine", () => ({ attemptAutomaticGuestRecovery }));

import { deliveryTokenMatches } from "@/lib/guest-delivery";
import { GET } from "./route";

const request = new Request("http://localhost/api/orders/order-code/delivery", {
  headers: { authorization: "Bearer isolated-test-token" },
});

const deliveredOrderFixture = {
  id: "order-code",
  publicToken: "public-token",
  status: "DELIVERED",
  createdAt: new Date("2026-09-13T12:00:00Z"),
  deliveryTokenHash: "hash",
  deliveryTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  deliveryTokenRevokedAt: null,
  items: [{ product: { name: "FRPFILE Premium" } }],
  payment: { status: "PAID" },
  fulfillment: {
    status: "FULFILLED",
    delivery: {
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
      internalReplay: "must-not-leak",
    },
  },
};

describe("secure customer delivery endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attemptAutomaticGuestRecovery.mockResolvedValue(false);
    db.deliveryAccessAttempt.count.mockResolvedValue(0);
    db.order.findUnique.mockResolvedValue(deliveredOrderFixture);
  });

  it("returns CODE after token validation and strips internal properties", async () => {
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.delivery).toEqual({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
    });
    expect(JSON.stringify(payload)).not.toContain("internalReplay");
  });

  it("does not release delivery before the final order state", async () => {
    db.order.findUnique.mockResolvedValueOnce({
      ...deliveredOrderFixture,
      status: "PROCESSING",
    });
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect((await response.json()).data.delivery).toBeNull();
  });

  it("aciona recovery automático quando PAID sem entrega e reflete a convergência na mesma resposta (backup por e-mail também converge sozinho)", async () => {
    const paidNotDelivered = {
      ...deliveredOrderFixture,
      status: "FAILED",
      fulfillment: { status: "FAILED", delivery: null },
    };
    db.order.findUnique
      .mockResolvedValueOnce(paidNotDelivered)
      .mockResolvedValueOnce(deliveredOrderFixture);
    attemptAutomaticGuestRecovery.mockResolvedValue(true);

    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });

    expect(attemptAutomaticGuestRecovery).toHaveBeenCalledWith("order-code");
    expect(db.order.findUnique).toHaveBeenCalledTimes(2);
    const payload = await response.json();
    expect(payload.data.status).toBe("DELIVERED");
    expect(payload.data.delivery).toEqual({
      deliveryType: "CODE",
      title: "FRPFILE Premium",
      credential: "SAFE-CODE",
    });
  });

  it("NÃO aciona recovery automático quando o pedido já está DELIVERED", async () => {
    await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    expect(attemptAutomaticGuestRecovery).not.toHaveBeenCalled();
  });
});

describe("licenseActivation na resposta de entrega", () => {
  const params = { params: Promise.resolve({ id: "order-code" }) };
  const licenseOrder = {
    ...deliveredOrderFixture,
    items: [
      {
        product: {
          name: "UnlockTool — Licença 3 meses",
          type: "LICENSE",
          brand: { name: "UnlockTool" },
        },
      },
    ],
    fulfillment: {
      status: "FULFILLED",
      delivery: { deliveryType: "LICENSE", title: "UnlockTool", credential: "Success" },
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
    attemptAutomaticGuestRecovery.mockResolvedValue(false);
    db.deliveryAccessAttempt.count.mockResolvedValue(0);
    vi.mocked(deliveryTokenMatches).mockReturnValue(true);
  });

  it("devolve licenseActivation=true só para UnlockTool + LICENSE, sem outros campos novos", async () => {
    db.order.findUnique.mockResolvedValue(licenseOrder);
    const payload = await (await GET(request, params)).json();
    expect(payload.data.licenseActivation).toBe(true);
    expect(Object.keys(payload.data).sort()).toEqual(
      [
        "createdAt",
        "delivery",
        "fulfillmentStatus",
        "id",
        "licenseActivation",
        "number",
        "paymentStatus",
        "products",
        "status",
      ].sort(),
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("brand");
    expect(serialized).not.toContain("providerFields");
  });

  it.each([
    ["unlocktool-6h (aluguel)", "UnlockTool 6 horas", "RENTAL", "UnlockTool"],
    ["SamsungTool KG (LICENSE de outra marca)", "SamsungTool — KG Bypass", "LICENSE", "SamsungTool"],
    ["Phoenix", "Phoenix Service Tool", "TOOL", "Phoenix ServiceTool"],
  ])("%s: campo ausente e resposta idêntica à anterior", async (_label, name, type, brand) => {
    db.order.findUnique.mockResolvedValue({
      ...deliveredOrderFixture,
      items: [{ product: { name, type, brand: { name: brand } } }],
    });
    const payload = await (await GET(request, params)).json();
    expect("licenseActivation" in payload.data).toBe(false);
    expect(Object.keys(payload.data).sort()).toEqual(
      ["createdAt", "delivery", "fulfillmentStatus", "id", "number", "paymentStatus", "products", "status"].sort(),
    );
  });

  it("marca ausente (fixture legado só com name): campo ausente", async () => {
    db.order.findUnique.mockResolvedValue(deliveredOrderFixture);
    const payload = await (await GET(request, params)).json();
    expect("licenseActivation" in payload.data).toBe(false);
  });

  it("token inválido continua 403 e registra a tentativa, sem vazar a flag", async () => {
    vi.mocked(deliveryTokenMatches).mockReturnValue(false);
    db.order.findUnique.mockResolvedValue(licenseOrder);
    const response = await GET(request, params);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Acesso não autorizado." });
    expect(db.deliveryAccessAttempt.create).toHaveBeenCalledTimes(1);
  });

  it("pedido inexistente continua 403 sem registrar tentativa", async () => {
    db.order.findUnique.mockResolvedValue(null);
    const response = await GET(request, params);
    expect(response.status).toBe(403);
    expect(db.deliveryAccessAttempt.create).not.toHaveBeenCalled();
  });

  it("rate limit continua 429", async () => {
    db.deliveryAccessAttempt.count.mockResolvedValue(10);
    const response = await GET(request, params);
    expect(response.status).toBe(429);
  });
});

describe("entrega mínima de licença na resposta de /acompanhar", () => {
  it("DELIVERED com delivery mínimo: devolve a entrega (não nula) e licenseActivation=true", async () => {
    vi.clearAllMocks();
    attemptAutomaticGuestRecovery.mockResolvedValue(false);
    db.deliveryAccessAttempt.count.mockResolvedValue(0);
    vi.mocked(deliveryTokenMatches).mockReturnValue(true);
    db.order.findUnique.mockResolvedValue({
      ...deliveredOrderFixture,
      items: [
        {
          product: { name: "UnlockTool — Licença 3 meses", type: "LICENSE", brand: { name: "UnlockTool" } },
        },
      ],
      fulfillment: {
        status: "FULFILLED",
        delivery: {
          kind: "provider-delivery",
          deliveryType: "LICENSE",
          title: "UnlockTool — Licença 3 meses",
          instructions: "A ativação foi confirmada pelo fornecedor, sem retorno textual.",
        },
      },
    });
    const response = await GET(request, { params: Promise.resolve({ id: "order-code" }) });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.licenseActivation).toBe(true);
    expect(payload.data.delivery).toEqual({
      deliveryType: "LICENSE",
      title: "UnlockTool — Licença 3 meses",
      instructions: "A ativação foi confirmada pelo fornecedor, sem retorno textual.",
    });
  });
});
