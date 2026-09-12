import { describe, expect, it, vi } from "vitest";
import { handleAdminPixReconciliation } from "./admin-pix-route";

describe("reconciliação administrativa do PIX", () => {
  it("bloqueia usuário não ADMIN antes da consulta", async () => {
    const reconcile = vi.fn();
    const response = await handleAdminPixReconciliation(
      "order-test",
      async () => { throw new Error("FORBIDDEN"); },
      reconcile,
      vi.fn(),
    );
    expect(response.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("permite ao ADMIN reconciliar e registra auditoria", async () => {
    const audit = vi.fn(async () => undefined);
    const response = await handleAdminPixReconciliation(
      "order-test",
      async () => ({ id: "admin-test" }),
      async () => ({ status: "RECONCILED" }),
      audit,
    );
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledWith("admin-test", "order-test", { status: "RECONCILED" });
  });

  it("retorna erro controlado quando o provider falha", async () => {
    const response = await handleAdminPixReconciliation(
      "order-test",
      async () => ({ id: "admin-test" }),
      async () => { throw new Error("provider detail"); },
      vi.fn(),
    );
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.code).toBe("PIX_RECONCILIATION_FAILED");
    expect(JSON.stringify(payload)).not.toContain("provider detail");
  });
});
