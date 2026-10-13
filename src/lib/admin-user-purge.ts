// Exclusão PERMANENTE de usuário pelo Admin (hard delete em cascata). Diferente
// do DELETE comum (que desativa quando há histórico), aqui somem pedidos,
// pagamentos, eventos, entregas, saldo, ledger, chaves de revenda e tokens.
// Irreversível: a rota exige digitar o e-mail do usuário e grava a auditoria
// na mesma transação, antes de apagar qualquer coisa.
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

export type PurgeTarget = {
  id: string;
  email: string;
  role: string;
  active: boolean;
  authoredAuditLogs: number;
  pendingPayments: number;
  ordersInProgress: number;
};

export type PurgeBlock =
  | "CONFIRMATION_MISMATCH"
  | "SELF"
  | "LAST_ADMIN"
  | "HAS_ADMIN_HISTORY"
  | "PAYMENT_PENDING"
  | "ORDER_IN_PROGRESS";

export const purgeBlockMessages: Record<PurgeBlock, string> = {
  CONFIRMATION_MISMATCH: "O e-mail digitado não confere com o do usuário.",
  SELF: "Você não pode excluir sua própria conta.",
  LAST_ADMIN: "O último administrador ativo deve ser preservado.",
  // AuditLog.actor é RESTRICT: apagar quem executou ações administrativas
  // apagaria a trilha de auditoria. Nesses casos, rebaixe e desative.
  HAS_ADMIN_HISTORY: "Este usuário executou ações administrativas registradas na auditoria. Rebaixe a role e desative a conta em vez de excluir.",
  // Um PIX pendente ainda pode ser pago, e um pedido em andamento ainda pode
  // receber callback do fornecedor: excluir agora deixaria dinheiro sem pedido.
  PAYMENT_PENDING: "Há pagamento PIX pendente para este usuário. Aguarde expirar ou cancele antes de excluir.",
  ORDER_IN_PROGRESS: "Há pedido pago ainda em processamento. Conclua ou cancele a entrega antes de excluir.",
};

export function purgeDecision(
  target: PurgeTarget,
  input: { confirmEmail: string; actorId: string; activeAdminCount: number },
): PurgeBlock | null {
  if (input.confirmEmail.trim().toLowerCase() !== target.email.trim().toLowerCase()) return "CONFIRMATION_MISMATCH";
  if (target.id === input.actorId) return "SELF";
  if (target.role === "ADMIN" && target.active && input.activeAdminCount <= 1) return "LAST_ADMIN";
  if (target.authoredAuditLogs > 0) return "HAS_ADMIN_HISTORY";
  if (target.pendingPayments > 0) return "PAYMENT_PENDING";
  if (target.ordersInProgress > 0) return "ORDER_IN_PROGRESS";
  return null;
}

export const pendingPaymentWhere = (userId: string, now: Date): Prisma.PaymentWhereInput => ({
  order: { customerId: userId },
  status: PaymentStatus.PENDING,
  expiresAt: { gt: now },
});

export const inProgressOrderWhere = (userId: string): Prisma.OrderWhereInput => ({
  customerId: userId,
  status: { in: [OrderStatus.PAID, OrderStatus.PROCESSING] },
});

type Tx = Pick<
  Prisma.TransactionClient,
  "order" | "accountLedgerEntry" | "accountBalance" | "resellerApiKey" | "passwordResetToken" | "user"
>;

// Ordem importa: Order e AccountLedgerEntry/AccountBalance/ResellerApiKey
// apontam para User sem cascade. Itens, pagamento (+eventos), fulfillment,
// provider orders (+callbacks), eventos, notificações e tentativas de acesso
// caem em cascata ao apagar o Order.
export async function purgeUser(tx: Tx, userId: string) {
  const orders = await tx.order.deleteMany({ where: { customerId: userId } });
  const ledgerEntries = await tx.accountLedgerEntry.deleteMany({ where: { userId } });
  await tx.accountBalance.deleteMany({ where: { userId } });
  const resellerApiKeys = await tx.resellerApiKey.deleteMany({ where: { userId } });
  await tx.passwordResetToken.deleteMany({ where: { userId } });
  await tx.user.delete({ where: { id: userId } });
  return { orders: orders.count, ledgerEntries: ledgerEntries.count, resellerApiKeys: resellerApiKeys.count };
}
