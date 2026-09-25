import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  BalanceTopupAdapter,
  INTERNAL_BALANCE_CODE,
  balanceTopupIdentity,
  creditAmountFromMetadata,
} from "./internal-balance";
import { resolveProviderAdapter } from "./registry";
import { createFakeLedgerDb, type FakeState } from "../testing/fake-ledger-db";

const topupProduct = (creditAmountCents: unknown, externalProductId = "topup-1000", code = INTERNAL_BALANCE_CODE) => ({
  externalProductId,
  metadata: { creditAmountCents },
  provider: { code },
});

function setup(overrides: Partial<FakeState> = {}) {
  const db = createFakeLedgerDb({
    users: [{ id: "buyer", role: "USER", active: true, passwordHash: "hash" }],
    orders: [{ id: "order-1", customerId: "buyer", providerProduct: topupProduct(1000) }],
    ...overrides,
  });
  const adapter = new BalanceTopupAdapter(db as never);
  return { db, adapter };
}

const run = (adapter: BalanceTopupAdapter, paidAmountCents = 1000, providerProductId = "topup-1000") =>
  adapter.createOrder({
    providerProductId,
    reference: "provider-order-1",
    payload: { orderId: "order-1", paidAmountCents, Quantity: 1, fields: {} },
  });

describe("BalanceTopupAdapter — provider interno da Recarga de Saldo", () => {
  it("é resolvido pelo registry com código próprio (não mock-sandbox) e suporta reconciliação", () => {
    const adapter = resolveProviderAdapter("internal-balance");
    expect(adapter).toBeInstanceOf(BalanceTopupAdapter);
    expect(adapter?.code).toBe("internal-balance");
    expect(adapter?.supportsReconciliation).toBe(true);
  });

  it("credita o comprador lido de Order.customerId e devolve recibo TEXT", async () => {
    const { db, adapter } = setup();
    const result = await run(adapter);
    expect(db.state.entries).toEqual([
      expect.objectContaining({ userId: "buyer", type: "TOPUP", amountCents: 1000, sourceOrderId: "order-1" }),
    ]);
    expect(result).toMatchObject({
      status: "COMPLETED",
      externalOrderId: "balance-topup:order-1",
      delivery: { deliveryType: "TEXT", title: "Saldo creditado" },
    });
    expect(String(result.delivery?.instructions).replace(/\s/g, " ")).toBe(
      "Saldo de R$ 10,00 creditado. Saldo atual: R$ 10,00.",
    );
  });

  it("o valor creditado vem do metadata do ProviderProduct, nunca do valor pago", async () => {
    const { db, adapter } = setup({
      orders: [{ id: "order-1", customerId: "buyer", providerProduct: topupProduct(3000, "topup-3000") }],
    });
    await run(adapter, 2400, "topup-3000");
    expect(db.state.entries[0].amountCents).toBe(3000);
    expect(db.state.balances[0].balanceCents).toBe(3000);
  });

  it("é idempotente: uma 2ª execução para o mesmo pedido não credita de novo", async () => {
    const { db, adapter } = setup();
    await run(adapter);
    const again = await run(adapter);
    expect(again.status).toBe("COMPLETED");
    expect(db.state.entries).toHaveLength(1);
    expect(db.state.balances[0].balanceCents).toBe(1000);
  });

  it("nunca credita uma conta guest (convite pendente)", async () => {
    const { db, adapter } = setup({ users: [{ id: "buyer", role: "CUSTOMER", active: true, passwordHash: "PENDING_INVITE" }] });
    await expect(run(adapter)).rejects.toThrow("BALANCE_TOPUP_GUEST_NOT_ALLOWED");
    expect(db.state.entries).toHaveLength(0);
  });

  it("recusa quando o ProviderProduct comprado não é o interno ou não confere", async () => {
    const wrongProvider = setup({ orders: [{ id: "order-1", customerId: "buyer", providerProduct: topupProduct(1000, "topup-1000", "adclean") }] });
    await expect(run(wrongProvider.adapter)).rejects.toThrow("BALANCE_TOPUP_PROVIDER_PRODUCT_MISMATCH");
    const { adapter } = setup();
    await expect(run(adapter, 1000, "topup-5000")).rejects.toThrow("BALANCE_TOPUP_PROVIDER_PRODUCT_MISMATCH");
  });

  it("recusa metadata sem creditAmountCents inteiro e positivo, sem gravar nada", async () => {
    for (const bad of [undefined, 0, -100, 10.5, "1000"]) expect(() => creditAmountFromMetadata({ creditAmountCents: bad })).toThrow();
    const { db, adapter } = setup({ orders: [{ id: "order-1", customerId: "buyer", providerProduct: topupProduct("1000") }] });
    await expect(run(adapter)).rejects.toThrow("BALANCE_TOPUP_CREDIT_AMOUNT_INVALID");
    expect(db.state.balances[0]?.balanceCents ?? 0).toBe(0);
  });

  it("reconciliação: identidade determinística e consulta pelo sourceOrderId no ledger, sem creditar", async () => {
    const { db, adapter } = setup();
    expect(adapter.buildReconciliationIdentity("order-1")).toBe(balanceTopupIdentity("order-1"));
    expect(await adapter.getOrderStatus("balance-topup:order-1")).toMatchObject({ status: "FAILED", error: "BALANCE_TOPUP_NOT_CREDITED" });
    expect(db.state.entries).toHaveLength(0);
    await run(adapter);
    expect(await adapter.getOrderStatus("balance-topup:order-1")).toMatchObject({ status: "COMPLETED", delivery: { deliveryType: "TEXT" } });
    expect(await adapter.getOrderStatus("outra-coisa")).toMatchObject({ status: "FAILED", error: "BALANCE_TOPUP_IDENTITY_INVALID" });
  });
});
