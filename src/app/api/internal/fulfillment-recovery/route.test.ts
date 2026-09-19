import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attemptAutomaticGuestRecovery } = vi.hoisted(() => ({
  attemptAutomaticGuestRecovery: vi.fn(),
}));
const db = vi.hoisted(() => ({
  order: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/fulfillment-engine", () => ({
  attemptAutomaticGuestRecovery,
  safeErrorInfo: (error: unknown) =>
    error instanceof Error ? { name: error.name, code: "FULFILLMENT_INTERNAL_ERROR" } : { name: "UnknownError" },
}));

import { GET } from "./route";

const req = (authorization?: string) =>
  new Request("https://test/api/internal/fulfillment-recovery", {
    headers: authorization ? { authorization } : {},
  });

describe("GET /api/internal/fulfillment-recovery — sweep server-side durável (Supabase Cron)", () => {
  beforeEach(() => {
    db.order.findMany.mockReset();
    attemptAutomaticGuestRecovery.mockReset();
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("401 sem CRON_SECRET configurado — nunca autoriza por omissão", async () => {
    const response = await GET(req("Bearer anything"));
    expect(response.status).toBe(401);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it("401 com Authorization incorreto", async () => {
    process.env.CRON_SECRET = "correct-secret-value-32-chars-ok";
    const response = await GET(req("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it("busca candidatos com filtro correto, ordenado por updatedAt, com limite (nunca findMany sem take)", async () => {
    process.env.CRON_SECRET = "correct-secret-value-32-chars-ok";
    db.order.findMany.mockResolvedValue([]);
    await GET(req("Bearer correct-secret-value-32-chars-ok"));
    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          payment: { status: "PAID" },
          status: { notIn: ["DELIVERED", "CANCELLED"] },
        },
        orderBy: { updatedAt: "asc" },
        take: expect.any(Number),
      }),
    );
    const [[call]] = db.order.findMany.mock.calls;
    expect(call.take).toBeGreaterThan(0);
    expect(call.take).toBeLessThanOrEqual(50); // limitado, não ilimitado
  });

  it("processa cada candidato sequencialmente via attemptAutomaticGuestRecovery (mesmo classificador do GET/Admin) e resume o resultado", async () => {
    process.env.CRON_SECRET = "correct-secret-value-32-chars-ok";
    db.order.findMany.mockResolvedValue([{ id: "order-1" }, { id: "order-2" }, { id: "order-3" }]);
    attemptAutomaticGuestRecovery
      .mockResolvedValueOnce(true) // order-1: convergiu/tentou
      .mockResolvedValueOnce(false) // order-2: throttlado/no-op
      .mockRejectedValueOnce(new Error("unexpected")); // order-3: falha inesperada

    const response = await GET(req("Bearer correct-secret-value-32-chars-ok"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(attemptAutomaticGuestRecovery).toHaveBeenCalledTimes(3);
    expect(attemptAutomaticGuestRecovery).toHaveBeenNthCalledWith(1, "order-1");
    expect(attemptAutomaticGuestRecovery).toHaveBeenNthCalledWith(2, "order-2");
    expect(attemptAutomaticGuestRecovery).toHaveBeenNthCalledWith(3, "order-3");
    expect(payload.data).toEqual({ candidates: 3, attempted: 1, skipped: 1, errored: 1 });
  });

  it("uma falha em um pedido NUNCA interrompe o processamento dos demais", async () => {
    process.env.CRON_SECRET = "correct-secret-value-32-chars-ok";
    db.order.findMany.mockResolvedValue([{ id: "order-a" }, { id: "order-b" }]);
    attemptAutomaticGuestRecovery
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(true);

    const response = await GET(req("Bearer correct-secret-value-32-chars-ok"));
    expect(response.status).toBe(200);
    expect(attemptAutomaticGuestRecovery).toHaveBeenCalledTimes(2);
  });

  it("não vaza nenhum orderId real no corpo da resposta — só contagens", async () => {
    process.env.CRON_SECRET = "correct-secret-value-32-chars-ok";
    db.order.findMany.mockResolvedValue([{ id: "order-real-id-xyz" }]);
    attemptAutomaticGuestRecovery.mockResolvedValue(true);
    const response = await GET(req("Bearer correct-secret-value-32-chars-ok"));
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain("order-real-id-xyz");
  });
});
