import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  AccountBalanceError,
  creditTopup,
  debitOrderPurchase,
  debitPurchase,
  formatBRL,
  refundPurchase,
} from "./account-balance";
import { createFakeLedgerDb } from "./testing/fake-ledger-db";

const asTx = (db: unknown) => db as Prisma.TransactionClient;
const customer = (customerTier = "NORMAL", extra: Record<string, unknown> = {}) => ({
  id: "u1", role: "USER", active: true, passwordHash: "hash", customerTier, canUseBalanceAsPayment: false, balanceTopupBlocked: false, ...extra,
});

describe("saldo pré-pago — ledger imutável com saldo materializado", () => {
  it("crédito de recarga cria a linha de saldo sob demanda e grava balanceAfterCents", async () => {
    const db = createFakeLedgerDb({ users: [customer()] });
    const { entry, created } = await creditTopup(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1000 });
    expect(created).toBe(true);
    expect(entry).toMatchObject({ type: "TOPUP", amountCents: 1000, balanceAfterCents: 1000, sourceOrderId: "o1" });
    expect(db.state.balances).toEqual([expect.objectContaining({ userId: "u1", balanceCents: 1000, enabled: true })]);
  });

  it("crédito é idempotente por sourceOrderId: o mesmo pedido nunca credita duas vezes", async () => {
    const db = createFakeLedgerDb({ users: [customer()] });
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

  it("débito de pedido da loja grava PURCHASE com sourceOrderId e é idempotente por pedido", async () => {
    const db = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: true }] });
    const first = await debitOrderPurchase(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1500 });
    expect(first.entry).toMatchObject({ type: "PURCHASE", amountCents: -1500, balanceAfterCents: 3500, sourceOrderId: "o1" });
    const again = await debitOrderPurchase(asTx(db), { userId: "u1", orderId: "o1", amountCents: 1500 });
    expect(again).toMatchObject({ created: false, entry: { id: first.entry.id } });
    expect(db.state.entries).toHaveLength(1);
    expect(db.state.balances[0].balanceCents).toBe(3500);
  });

  it("débito de pedido da loja exige saldo habilitado e suficiente", async () => {
    const disabled = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 5000, enabled: false }] });
    await expect(debitOrderPurchase(asTx(disabled), { userId: "u1", orderId: "o1", amountCents: 1000 })).rejects.toThrow(
      "BALANCE_NOT_ENABLED",
    );
    const poor = createFakeLedgerDb({ balances: [{ id: "b1", userId: "u1", balanceCents: 500, enabled: true }] });
    await expect(debitOrderPurchase(asTx(poor), { userId: "u1", orderId: "o1", amountCents: 1000 })).rejects.toThrow(
      "INSUFFICIENT_BALANCE",
    );
    expect(poor.state.entries).toHaveLength(0);
    expect(poor.state.balances[0].balanceCents).toBe(500);
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

describe("recarga promove a PREMIUM_PLUS na mesma transação do crédito (R1/R2/R8)", () => {
  // Como o adapter interno chama: creditTopup dentro de um $transaction.
  const credit = (db: ReturnType<typeof createFakeLedgerDb>, amountCents = 1500, orderId = "o1") =>
    db.$transaction((tx) => creditTopup(asTx(tx), { userId: "u1", orderId, amountCents }));

  it.each(["NORMAL", "PREMIUM"])("%s sem linha de saldo: credita, ativa o saldo e promove com uso de saldo liberado", async (tier) => {
    const db = createFakeLedgerDb({ users: [customer(tier)] });
    const result = await credit(db);
    expect(result).toMatchObject({ created: true, promoted: true, entry: { type: "TOPUP", amountCents: 1500 } });
    expect(db.state.balances[0]).toMatchObject({ balanceCents: 1500, enabled: true });
    expect(db.state.users[0]).toMatchObject({ customerTier: "PREMIUM_PLUS", canUseBalanceAsPayment: true });
  });

  it("qualquer valor creditado promove (sem mínimo próprio além do da recarga)", async () => {
    const db = createFakeLedgerDb({ users: [customer()], balances: [{ id: "b1", userId: "u1", balanceCents: 0, enabled: false }] });
    await credit(db, 1);
    expect(db.state.users[0].customerTier).toBe("PREMIUM_PLUS");
    expect(db.state.balances[0].enabled).toBe(true);
  });

  it("recarga bloqueada pelo Admin: o valor entra e o saldo é ativado (aparece), mas nada é promovido", async () => {
    const db = createFakeLedgerDb({
      users: [customer("NORMAL", { balanceTopupBlocked: true })],
      balances: [{ id: "b1", userId: "u1", balanceCents: 200, enabled: false }],
    });
    const result = await credit(db);
    expect(result).toMatchObject({ created: true, promoted: false });
    expect(db.state.balances[0]).toMatchObject({ balanceCents: 1700, enabled: true });
    expect(db.state.users[0]).toMatchObject({ customerTier: "NORMAL", canUseBalanceAsPayment: false });
  });

  it("cliente bloqueado sem linha de saldo recebe o TOPUP: saldo criado com enabled = true, sem promoção", async () => {
    const db = createFakeLedgerDb({ users: [customer("PREMIUM", { balanceTopupBlocked: true })] });
    const result = await credit(db);
    expect(result).toMatchObject({ created: true, promoted: false, entry: { type: "TOPUP", amountCents: 1500 } });
    expect(db.state.balances).toEqual([expect.objectContaining({ userId: "u1", balanceCents: 1500, enabled: true })]);
    expect(db.state.users[0]).toMatchObject({ customerTier: "PREMIUM", canUseBalanceAsPayment: false });
  });

  it("rebaixado e bloqueado: o TOPUP ativa o saldo e preserva a permissão de gastar, sem voltar a PREMIUM_PLUS", async () => {
    const db = createFakeLedgerDb({
      users: [customer("NORMAL", { balanceTopupBlocked: true, canUseBalanceAsPayment: true })],
      balances: [{ id: "b1", userId: "u1", balanceCents: 300, enabled: false }],
    });
    await credit(db);
    expect(db.state.balances[0]).toMatchObject({ balanceCents: 1800, enabled: true });
    expect(db.state.users[0]).toMatchObject({ customerTier: "NORMAL", canUseBalanceAsPayment: true });
  });

  it("falha na promoção desfaz o crédito: nada creditado, nada promovido", async () => {
    const db = createFakeLedgerDb({ users: [customer()] });
    db.user.update = async () => { throw new Error("DB_DOWN"); };
    await expect(credit(db)).rejects.toThrow("DB_DOWN");
    expect(db.state.entries).toHaveLength(0);
    expect(db.state.balances).toEqual([]);
    expect(db.state.users[0]).toMatchObject({ customerTier: "NORMAL", canUseBalanceAsPayment: false });
  });

  it("falha ao gravar o lançamento: nada creditado, nada promovido", async () => {
    const db = createFakeLedgerDb({ users: [customer()], balances: [{ id: "b1", userId: "u1", balanceCents: 0, enabled: false }] });
    db.accountLedgerEntry.create = async () => { throw new Error("DB_DOWN"); };
    await expect(credit(db)).rejects.toThrow("DB_DOWN");
    expect(db.state.balances[0]).toMatchObject({ balanceCents: 0, enabled: false });
    expect(db.state.users[0].customerTier).toBe("NORMAL");
  });

  it("valor inválido ou usuário inexistente: nada creditado, nada promovido", async () => {
    const db = createFakeLedgerDb({ users: [customer()] });
    await expect(credit(db, 0)).rejects.toThrow("INVALID_CREDIT_AMOUNT");
    await expect(db.$transaction((tx) => creditTopup(asTx(tx), { userId: "ghost", orderId: "o2", amountCents: 1500 }))).rejects.toThrow("USER_NOT_FOUND");
    expect(db.state.entries).toHaveLength(0);
    expect(db.state.users[0].customerTier).toBe("NORMAL");
  });

  it("reprocessar o mesmo pedido não promove de novo (ex.: Admin rebaixou depois do crédito)", async () => {
    const db = createFakeLedgerDb({ users: [customer()] });
    await credit(db);
    Object.assign(db.state.users[0], { customerTier: "NORMAL" });
    const again = await credit(db);
    expect(again).toMatchObject({ created: false, promoted: false });
    expect(db.state.users[0].customerTier).toBe("NORMAL");
    expect(db.state.entries).toHaveLength(1);
  });

  it("nunca rebaixa: PREMIUM_PLUS segue PREMIUM_PLUS", async () => {
    const db = createFakeLedgerDb({ users: [customer("PREMIUM_PLUS")] });
    await credit(db);
    expect(db.state.users[0].customerTier).toBe("PREMIUM_PLUS");
  });
});
