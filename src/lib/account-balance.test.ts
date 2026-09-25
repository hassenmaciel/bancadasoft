import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  AccountBalanceError,
  creditTopup,
  debitPurchase,
  formatBRL,
  refundPurchase,
} from "./account-balance";
import { createFakeLedgerDb } from "./testing/fake-ledger-db";

const asTx = (db: unknown) => db as Prisma.TransactionClient;

describe("saldo pré-pago — ledger imutável com saldo materializado", () => {
  it("crédito de recarga cria a linha de saldo sob demanda e grava balanceAfterCents", async () => {
    const db = createFakeLedgerDb();
    const { entry, created } = await creditTopup(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1000 });
    expect(created).toBe(true);
    expect(entry).toMatchObject({ type: "TOPUP", amountCents: 1000, balanceAfterCents: 1000, sourceOrderId: "o1" });
    expect(db.state.balances).toEqual([expect.objectContaining({ userId: "u1", balanceCents: 1000, enabled: false })]);
  });

  it("crédito é idempotente por sourceOrderId: o mesmo pedido nunca credita duas vezes", async () => {
    const db = createFakeLedgerDb();
    await creditTopup(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1000 });
    const again = await creditTopup(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1000 });
    expect(again.created).toBe(false);
    expect(db.state.entries).toHaveLength(1);
    expect(db.state.balances[0].balanceCents).toBe(1000);
  });

  it("recusa valor de crédito inválido", async () => {
    const db = createFakeLedgerDb();
    await expect(creditTopup(asTx(db), { userId: "u1", orderId: "o1", amountCents: 0 })).rejects.toThrow(
      "INVALID_CREDIT_AMOUNT",
    );
  });

  it("débito exige saldo habilitado", async () => {
    const db = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: false }] });
    await expect(
      debitPurchase(asTx(db), { userId: "u1", externalReference: "ref-1", amountCents: 1000 }),
    ).rejects.toThrow("BALANCE_NOT_ENABLED");
    expect(db.state.entries).toHaveLength(0);
  });

  it("débito nunca deixa saldo negativo e não grava nada quando falta saldo", async () => {
    const db = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 500, enabled: true }] });
    const attempt = debitPurchase(asTx(db), { userId: "u1", externalReference: "ref-1", amountCents: 1000 });
    await expect(attempt).rejects.toBeInstanceOf(AccountBalanceError);
    await expect(attempt).rejects.toThrow("INSUFFICIENT_BALANCE");
    expect(db.state.entries).toHaveLength(0);
    expect(db.state.balances[0].balanceCents).toBe(500);
  });

  it("débito é negativo no ledger, atualiza o saldo e é idempotente por externalReference", async () => {
    const db = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    const first = await debitPurchase(asTx(db), { userId: "u1", externalReference: "ref-1", amountCents: 1500 });
    expect(first.entry).toMatchObject({ type: "PURCHASE", amountCents: -1500, balanceAfterCents: 3500 });
    const again = await debitPurchase(asTx(db), { userId: "u1", externalReference: "ref-1", amountCents: 1500 });
    expect(again).toMatchObject({ created: false, entry: { id: first.entry.id } });
    expect(db.state.balances[0].balanceCents).toBe(3500);
  });

  it("estorno devolve o valor com referência refund:<ref> e é idempotente", async () => {
    const db = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    const purchase = await debitPurchase(asTx(db), { userId: "u1", externalReference: "ref-1", amountCents: 1500 });
    const input = { userId: "u1", purchaseEntryId: purchase.entry.id, externalReference: "ref-1", amountCents: 1500 };
    const refund = await refundPurchase(asTx(db), input);
    expect(refund.entry).toMatchObject({ type: "REFUND", amountCents: 1500, balanceAfterCents: 5000, externalReference: "refund:ref-1" });
    expect((await refundPurchase(asTx(db), input)).created).toBe(false);
    expect(db.state.balances[0].balanceCents).toBe(5000);
  });

  it("formata centavos em reais", () => {
    expect(formatBRL(1000).replace(/\s/g, " ")).toBe("R$ 10,00");
  });
});
