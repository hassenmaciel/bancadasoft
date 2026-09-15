import { maskCpf, maskEmail, maskWhatsapp } from "./masking";
import {
  digitsOnly,
  isValidCpf,
  isValidWhatsapp,
  normalizeWhatsapp,
} from "./checkout-validation";

export type AccountFields = {
  name: string;
  email: string;
  cpfCnpj: string | null;
  whatsapp: string | null;
};

export type MissingIdentityField = "cpfCnpj" | "whatsapp";

export const MISSING_IDENTITY_FIELDS = ["cpfCnpj", "whatsapp"] as const;

export function missingIdentityFields(
  account: Pick<AccountFields, "cpfCnpj" | "whatsapp">,
): MissingIdentityField[] {
  const missing: MissingIdentityField[] = [];
  if (!account.cpfCnpj) missing.push("cpfCnpj");
  if (!account.whatsapp) missing.push("whatsapp");
  return missing;
}

export type CheckoutIdentitySummary = {
  name: string;
  maskedEmail: string;
  maskedCpf: string | null;
  maskedWhatsapp: string | null;
  missing: MissingIdentityField[];
  complete: boolean;
};

// Resumo seguro para o checkout do cliente logado (PARTE 3/4): nunca inclui
// CPF/e-mail/WhatsApp em texto puro, apenas o suficiente para o cliente
// confirmar a própria identidade antes de gerar o PIX.
export function buildCheckoutIdentitySummary(
  account: AccountFields,
): CheckoutIdentitySummary {
  const missing = missingIdentityFields(account);
  return {
    name: account.name,
    maskedEmail: maskEmail(account.email),
    maskedCpf: maskCpf(account.cpfCnpj),
    maskedWhatsapp: maskWhatsapp(account.whatsapp),
    missing,
    complete: missing.length === 0,
  };
}

export class IncompleteCheckoutIdentityError extends Error {
  constructor(public readonly missing: MissingIdentityField[]) {
    super("MISSING_CUSTOMER_FIELDS");
  }
}

export type ResolvedCheckoutIdentity = {
  name: string;
  email: string;
  cpfCnpj: string;
  whatsapp: string;
  /** Campos que precisam ser persistidos no cadastro por estarem ausentes hoje. */
  accountUpdates: Partial<Pick<AccountFields, "cpfCnpj" | "whatsapp">>;
};

/**
 * Resolve a identidade usada para o pedido de um cliente AUTENTICADO
 * (PARTE 3/4). A conta autenticada é a fonte principal: nome e e-mail nunca
 * vêm do client; CPF/WhatsApp só são aceitos do formulário quando ainda não
 * existem na conta, e nesse caso apenas esses campos são marcados para
 * atualização — nunca role, customerTier, senha ou e-mail.
 */
export function resolveAuthenticatedCheckoutIdentity(
  account: AccountFields,
  input: { cpfCnpj?: string | null; whatsapp?: string | null },
): ResolvedCheckoutIdentity {
  const missing = missingIdentityFields(account);
  const accountUpdates: ResolvedCheckoutIdentity["accountUpdates"] = {};

  let cpfCnpj = account.cpfCnpj;
  if (!cpfCnpj) {
    const provided = digitsOnly(input.cpfCnpj ?? "");
    if (!isValidCpf(provided)) throw new IncompleteCheckoutIdentityError(missing);
    cpfCnpj = provided;
    accountUpdates.cpfCnpj = provided;
  }

  let whatsapp = account.whatsapp;
  if (!whatsapp) {
    const provided = normalizeWhatsapp(input.whatsapp ?? "");
    if (!isValidWhatsapp(provided)) throw new IncompleteCheckoutIdentityError(missing);
    whatsapp = provided;
    accountUpdates.whatsapp = provided;
  }

  return {
    name: account.name,
    email: account.email,
    cpfCnpj,
    whatsapp,
    accountUpdates,
  };
}
