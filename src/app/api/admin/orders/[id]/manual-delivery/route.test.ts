import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, registerManualDelivery } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  registerManualDelivery: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/admin-manual-delivery", () => ({
  registerManualDelivery,
  ManualDeliveryError: class ManualDeliveryError extends Error {
    constructor(public readonly code: string) {
      super(code);
      this.name = "ManualDeliveryError";
    }
  },
}));
import { ManualDeliveryError } from "@/lib/admin-manual-delivery";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "order-1" }) };
const REASON = "Acesso entregue ao cliente pelo suporte; cliente confirmou.";
const post = (body: unknown) =>
  POST(
    new Request("https://test/api/admin/orders/order-1/manual-delivery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx,
  );

describe("POST /api/admin/orders/[id]/manual-delivery", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    registerManualDelivery.mockReset();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("403 sem admin, sem tocar no pedido", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await post({ reason: REASON });
    expect(response.status).toBe(403);
    expect(registerManualDelivery).not.toHaveBeenCalled();
  });

  it.each([
    ["sem corpo", "não é json"],
    ["sem motivo", {}],
    ["motivo curto", { reason: "curto" }],
    ["motivo só com espaços", { reason: "          " }],
    ["motivo curto após trim", { reason: "   123456789   " }],
    ["motivo longo", { reason: "x".repeat(501) }],
    ["motivo não-texto", { reason: 1234567890 }],
  ])("422 INVALID_REASON: %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("INVALID_REASON");
    expect(registerManualDelivery).not.toHaveBeenCalled();
  });

  it("200: aplica trim no motivo e repassa o admin autenticado", async () => {
    registerManualDelivery.mockResolvedValue({ status: "DELIVERED" });
    const response = await post({ reason: `  ${REASON}  ` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: "DELIVERED" } });
    expect(registerManualDelivery).toHaveBeenCalledWith({
      orderId: "order-1",
      adminId: "admin-1",
      reason: REASON,
    });
  });

  it("aceita exatamente 10 e 500 caracteres", async () => {
    registerManualDelivery.mockResolvedValue({ status: "DELIVERED" });
    expect((await post({ reason: "1234567890" })).status).toBe(200);
    expect((await post({ reason: "x".repeat(500) })).status).toBe(200);
  });

  it.each([
    "PAYMENT_NOT_PAID",
    "ORDER_ALREADY_DELIVERED",
    "ORDER_CANCELLED",
    "PROVIDER_ORDER_PROCESSING",
    "PROVIDER_ORDER_COMPLETED",
    "DELIVERY_ALREADY_EXISTS",
    "CONCURRENT_MANUAL_DELIVERY",
  ])("409 com código claro: %s", async (code) => {
    registerManualDelivery.mockRejectedValue(new ManualDeliveryError(code as never));
    const response = await post({ reason: REASON });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe("string");
  });

  it("404 quando o pedido não existe", async () => {
    registerManualDelivery.mockRejectedValue(new ManualDeliveryError("ORDER_NOT_FOUND"));
    const response = await post({ reason: REASON });
    expect(response.status).toBe(404);
  });

  it("500 genérico em erro inesperado, sem vazar detalhes", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registerManualDelivery.mockRejectedValue(new Error("connection string with secret"));
    const response = await post({ reason: REASON });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    consoleError.mockRestore();
  });
});
