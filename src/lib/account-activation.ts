export const PENDING_INVITE_HASH = "PENDING_INVITE";

export type ExistingAccount = {
  id: string;
  passwordHash: string;
  cpfCnpj: string | null;
};

export const isPendingInviteAccount = (
  account: Pick<ExistingAccount, "passwordHash">,
) => account.passwordHash === PENDING_INVITE_HASH;

export class AccountActivationConflictError extends Error {
  constructor() {
    super("ACCOUNT_ACTIVATION_CONFLICT");
  }
}

export type AccountActivationDecision =
  | { action: "CREATE" }
  | { action: "BLOCKED" }
  | { action: "ACTIVATE"; userId: string };

/**
 * Decide o que fazer com um cadastro público (PARTE 1/2/3/6):
 * - e-mail livre → CREATE (fluxo normal, inalterado).
 * - e-mail de conta REAL (passwordHash != PENDING_INVITE) → BLOCKED
 *   ("Já existe uma conta com este e-mail. Entre na sua conta.").
 * - e-mail de guest (PENDING_INVITE) com CPF correspondente → ACTIVATE do
 *   MESMO User.id (nunca cria um segundo usuário).
 * - e-mail de guest sem CPF armazenado, ou com CPF divergente → conflito:
 *   nunca ativa por correspondência fraca (só e-mail); fica dependendo de
 *   suporte/Admin, sem revelar por que falhou.
 */
export function resolveAccountActivation(
  existing: ExistingAccount | null,
  registration: { cpfCnpj: string },
): AccountActivationDecision {
  if (!existing) return { action: "CREATE" };
  if (!isPendingInviteAccount(existing)) return { action: "BLOCKED" };
  if (!existing.cpfCnpj || existing.cpfCnpj !== registration.cpfCnpj)
    throw new AccountActivationConflictError();
  return { action: "ACTIVATE", userId: existing.id };
}
