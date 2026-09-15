import { NextResponse } from "next/server";
import { publicUserCreateData, registrationSchema } from "./registration";
import {
  AccountActivationConflictError,
  resolveAccountActivation,
  type ExistingAccount,
} from "./account-activation";

export type RegisteredSessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  customerTier: "NORMAL" | "PREMIUM";
};

export type RegistrationDeps = {
  findExisting: (email: string) => Promise<ExistingAccount | null>;
  hashPassword: (password: string) => Promise<string>;
  /** Retorna null em caso de corrida (e-mail acabou de ser criado por outra requisição). */
  createUser: (
    data: ReturnType<typeof publicUserCreateData>,
  ) => Promise<RegisteredSessionUser | null>;
  /**
   * Ativa o MESMO User.id (PARTE 3/4): nunca cria um segundo usuário. role e
   * customerTier já vêm forçados para USER/NORMAL pelo próprio
   * handleRegistrationRequest — o client nunca controla esses valores.
   * Retorna null se o convite já não estiver mais PENDING_INVITE (corrida
   * com uma segunda ativação concorrente).
   */
  activateUser: (
    userId: string,
    data: {
      passwordHash: string;
      name: string;
      whatsapp: string;
      role: "USER";
      customerTier: "NORMAL";
    },
  ) => Promise<RegisteredSessionUser | null>;
  setSession: (user: RegisteredSessionUser) => Promise<void>;
};

const duplicateEmailResponse = () =>
  NextResponse.json(
    { error: "Já existe uma conta com este e-mail. Entre na sua conta." },
    { status: 409 },
  );

// PARTE 5: mensagem genérica — nunca revela CPF/WhatsApp/pedidos armazenados
// nem confirma que o e-mail pertence a um pedido guest anterior.
const activationConflictResponse = () =>
  NextResponse.json(
    {
      error:
        "Não foi possível concluir o cadastro com os dados informados. Confira seus dados ou entre em contato com o suporte.",
      code: "ACCOUNT_ACTIVATION_CONFLICT",
    },
    { status: 409 },
  );

export async function handleRegistrationRequest(
  body: unknown,
  deps: RegistrationDeps,
) {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revise os dados informados." },
      { status: 422 },
    );

  const existing = await deps.findExisting(parsed.data.email);
  let decision;
  try {
    decision = resolveAccountActivation(existing, parsed.data);
  } catch (error) {
    if (error instanceof AccountActivationConflictError)
      return activationConflictResponse();
    throw error;
  }
  if (decision.action === "BLOCKED") return duplicateEmailResponse();

  const passwordHash = await deps.hashPassword(parsed.data.password);

  if (decision.action === "ACTIVATE") {
    // PARTE 3/10: role/customerTier são sempre forçados aqui — nunca lidos
    // do payload do cliente (o schema também já os descarta antes disso).
    const user = await deps.activateUser(decision.userId, {
      passwordHash,
      name: parsed.data.name,
      whatsapp: parsed.data.whatsapp,
      role: "USER",
      customerTier: "NORMAL",
    });
    if (!user) return duplicateEmailResponse();
    await deps.setSession(user);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const user = await deps.createUser(publicUserCreateData(parsed.data, passwordHash));
  if (!user) return duplicateEmailResponse();
  await deps.setSession(user);
  return NextResponse.json({ ok: true }, { status: 201 });
}
