import { describe, expect, it, vi } from "vitest";
import {
  handleAdminDeliveryReveal,
  handleAdminDeliveryResend,
} from "./admin-delivery-route";

describe("exibir entrega no Admin (PARTE 7/8/17)", () => {
  it("bloqueia usuário não ADMIN antes de carregar a entrega", async () => {
    const loadDelivery = vi.fn();
    const response = await handleAdminDeliveryReveal(
      "order-1",
      async () => { throw new Error("FORBIDDEN"); },
      loadDelivery,
      vi.fn(),
    );
    expect(response.status).toBe(403);
    expect(loadDelivery).not.toHaveBeenCalled();
  });

  it("ADMIN acessa a entrega e a visualização é auditada", async () => {
    const audit = vi.fn(async () => undefined);
    const delivery = { username: "user-1", password: "pass-1" };
    const response = await handleAdminDeliveryReveal(
      "order-1",
      async () => ({ id: "admin-1" }),
      async () => ({ status: "DELIVERED", delivery: delivery as never }),
      audit,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.delivery).toEqual(delivery);
    expect(audit).toHaveBeenCalledWith("admin-1", "order-1");
  });

  it("pedido inexistente retorna 404 sem chamar auditoria", async () => {
    const audit = vi.fn();
    const response = await handleAdminDeliveryReveal(
      "order-x",
      async () => ({ id: "admin-1" }),
      async () => null,
      audit,
    );
    expect(response.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("reenviar acesso no Admin (PARTE 9/18)", () => {
  it("bloqueia usuário não ADMIN antes de reenviar", async () => {
    const resend = vi.fn();
    const response = await handleAdminDeliveryResend(
      "order-1",
      async () => { throw new Error("FORBIDDEN"); },
      resend,
      vi.fn(),
    );
    expect(response.status).toBe(403);
    expect(resend).not.toHaveBeenCalled();
  });

  it("reenvio bem-sucedido é auditado sem expor credenciais", async () => {
    const audit = vi.fn(async () => undefined);
    const response = await handleAdminDeliveryResend(
      "order-1",
      async () => ({ id: "admin-1" }),
      async () => ({ status: "SENT" }),
      audit,
    );
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith("admin-1", "order-1", { status: "SENT" });
    expect(JSON.stringify(audit.mock.calls[0])).not.toMatch(/password|username|credential/i);
  });

  it("clique duplicado dentro do cooldown não é tratado como erro", async () => {
    const audit = vi.fn(async () => undefined);
    const response = await handleAdminDeliveryResend(
      "order-1",
      async () => ({ id: "admin-1" }),
      async () => ({ status: "DUPLICATE" }),
      audit,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { status: "DUPLICATE" } });
  });

  it("pedido sem entrega concluída retorna erro controlado sem auditar", async () => {
    const audit = vi.fn();
    const response = await handleAdminDeliveryResend(
      "order-1",
      async () => ({ id: "admin-1" }),
      async () => ({ status: "SKIPPED" }),
      audit,
    );
    expect(response.status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });

  it("falha inesperada no envio retorna 502 controlado", async () => {
    const response = await handleAdminDeliveryResend(
      "order-1",
      async () => ({ id: "admin-1" }),
      async () => { throw new Error("boom"); },
      vi.fn(),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "RESEND_FAILED" });
  });
});
