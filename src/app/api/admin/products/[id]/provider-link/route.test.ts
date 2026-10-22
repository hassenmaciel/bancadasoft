import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, tx, transaction, recalculateProducts } = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    product: { findUnique: vi.fn() },
    providerProduct: { updateMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    requireAdmin: vi.fn(),
    tx,
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    recalculateProducts: vi.fn(),
  };
});
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }));
vi.mock("@/lib/pricing-service", () => ({ recalculateProducts }));
import { PUT } from "./route";
import { linkCandidateWhere } from "@/lib/admin-provider-link";

const summary = (id: string, externalProductId: string) => ({
  id, externalProductId, label: `Item ${externalProductId}`, provider: { id: "hu", code: "heartunlocks", name: "HeartUnlocks" },
});
const product = (overrides: Record<string, unknown> = {}) => ({
  status: "PAUSED", deliveryType: "AUTOMATIC", _count: { variants: 0 }, providerProducts: [], ...overrides,
});
const put = (body: unknown) =>
  PUT(new Request("https://test/api/admin/products/p1/provider-link", { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "p1" }),
  });

describe("PUT /api/admin/products/[id]/provider-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
    tx.product.findUnique.mockResolvedValue(product());
    tx.providerProduct.updateMany.mockResolvedValue({ count: 1 });
    tx.providerProduct.findUnique.mockResolvedValue(summary("pp-new", "2191"));
  });

  it("sem admin: 403 antes de qualquer leitura ou escrita", async () => {
    requireAdmin.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(403);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("corpo inválido: 422 sem transação", async () => {
    const response = await put({ providerProductId: "" });
    expect(response.status).toBe(422);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("vincula item livre: claim atômico com os critérios de candidato, trava o produto e audita before/after", async () => {
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(200);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.providerProduct.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "pp-new", ...linkCandidateWhere("p1") },
      data: { productId: "p1" },
    });
    expect(tx.providerProduct.updateMany).toHaveBeenNthCalledWith(2, {
      where: { productId: "p1", id: { not: "pp-new" } },
      data: { productId: null },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: {
      actorUserId: "admin-1", action: "PRODUCT_PROVIDER_LINK_CHANGED", entityType: "Product", entityId: "p1",
      metadata: { before: null, after: summary("pp-new", "2191") },
    } });
    expect(recalculateProducts).toHaveBeenCalledWith(["p1"]);
    expect((await response.json()).data.providerProduct).toEqual(summary("pp-new", "2191"));
  });

  it("produto com variantes: 422 sem nenhuma escrita", async () => {
    tx.product.findUnique.mockResolvedValue(product({ _count: { variants: 1 } }));
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/variantes/);
    expect(tx.providerProduct.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(recalculateProducts).not.toHaveBeenCalled();
  });

  it("produto inexistente: 404", async () => {
    tx.product.findUnique.mockResolvedValue(null);
    expect((await put({ providerProductId: "pp-new" })).status).toBe(404);
    expect(tx.providerProduct.updateMany).not.toHaveBeenCalled();
  });

  it("item já ligado a outro produto (claim não pega a linha): 409, mantém o vínculo atual e não audita", async () => {
    tx.product.findUnique.mockResolvedValue(product({ providerProducts: [summary("pp-old", "2334")] }));
    tx.providerProduct.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await put({ providerProductId: "pp-taken" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/ligado a outro produto/);
    expect(tx.providerProduct.updateMany).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(recalculateProducts).not.toHaveBeenCalled();
  });

  it("corrida: dois produtos disputam o mesmo item e só o primeiro claim vence", async () => {
    // O banco aplica o UPDATE com a guarda productId nulo: só uma linha muda.
    let owner: string | null = null;
    tx.providerProduct.updateMany.mockImplementation(async ({ where, data }) => {
      if (where.OR && data.productId) {
        const free = owner === null || owner === data.productId;
        if (free) owner = data.productId;
        return { count: free ? 1 : 0 };
      }
      return { count: 0 };
    });
    const first = await put({ providerProductId: "pp-new" });
    const second = await PUT(new Request("https://test/api/admin/products/p2/provider-link", { method: "PUT", body: JSON.stringify({ providerProductId: "pp-new" }) }), {
      params: Promise.resolve({ id: "p2" }),
    });
    expect([first.status, second.status]).toEqual([200, 409]);
    expect(owner).toBe("p1");
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
  });

  it("troca: liga o novo, desliga o anterior do mesmo produto e audita before/after", async () => {
    tx.product.findUnique.mockResolvedValue(product({ status: "PUBLISHED", providerProducts: [summary("pp-old", "2334")] }));
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(200);
    expect(tx.providerProduct.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({
      before: summary("pp-old", "2334"), after: summary("pp-new", "2191"),
    });
    expect(recalculateProducts).toHaveBeenCalledWith(["p1"]);
  });

  it("mesmo item já vinculado: sem escrita, sem auditoria", async () => {
    tx.product.findUnique.mockResolvedValue(product({ providerProducts: [summary("pp-new", "2191")] }));
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(200);
    expect(tx.providerProduct.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(recalculateProducts).not.toHaveBeenCalled();
  });

  it("remoção: desvincula todos os itens do produto e audita after nulo", async () => {
    tx.product.findUnique.mockResolvedValue(product({ status: "PAUSED", providerProducts: [summary("pp-old", "2334")] }));
    const response = await put({ providerProductId: null });
    expect(response.status).toBe(200);
    expect(tx.providerProduct.updateMany).toHaveBeenCalledWith({ where: { productId: "p1" }, data: { productId: null } });
    expect(tx.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ before: summary("pp-old", "2334"), after: null });
    expect(recalculateProducts).toHaveBeenCalledWith(["p1"]);
  });

  it("remoção de produto PUBLISHED e AUTOMATIC é recusada", async () => {
    tx.product.findUnique.mockResolvedValue(product({ status: "PUBLISHED", providerProducts: [summary("pp-old", "2334")] }));
    const response = await put({ providerProductId: null });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/Pause o produto/);
    expect(tx.providerProduct.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("remoção de produto PUBLISHED com entrega manual é permitida", async () => {
    tx.product.findUnique.mockResolvedValue(product({ status: "PUBLISHED", deliveryType: "MANUAL", providerProducts: [summary("pp-old", "2334")] }));
    expect((await put({ providerProductId: null })).status).toBe(200);
  });

  it("erro inesperado do banco: 409 genérico, sem recálculo", async () => {
    tx.providerProduct.updateMany.mockRejectedValue(new Error("db down"));
    const response = await put({ providerProductId: "pp-new" });
    expect(response.status).toBe(409);
    expect(recalculateProducts).not.toHaveBeenCalled();
  });
});
