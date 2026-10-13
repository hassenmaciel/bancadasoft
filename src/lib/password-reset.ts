// Recuperação de senha por e-mail. Regras:
// - o token vai só no link do e-mail; no banco fica apenas o SHA-256 dele;
// - expira em 1h e é de uso único (usedAt marcado de forma atômica);
// - o pedido nunca revela se o e-mail existe: a resposta é sempre a mesma e o
//   trabalho que depende do usuário (token + e-mail) roda depois da resposta;
// - rate limit por e-mail e por IP, contado para qualquer e-mail informado;
// - concluir a redefinição grava User.passwordChangedAt, que derruba todas as
//   sessões emitidas antes (ver session-validity.ts).
import { createHash, createHmac, randomBytes } from "node:crypto";
import { Resend } from "resend";
import { z } from "zod";
import { getAuthSecret } from "./auth-secret";
import { maskEmail } from "./masking";
import { hashPassword } from "./password";
import { prisma } from "./prisma";
import { ResendEmailTransport, type EmailTransport } from "./notifications/delivery-email";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_RATE_WINDOW_MS = 60 * 60 * 1000;
export const PASSWORD_RESET_MAX_PER_EMAIL = 3;
export const PASSWORD_RESET_MAX_PER_IP = 10;

// Mesma política de senha do cadastro e do Admin.
export const strongPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^A-Za-z0-9]/);

export const passwordResetRequestSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: strongPasswordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não coincidem.",
    path: ["passwordConfirmation"],
  });

export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createResetToken(now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS) };
}

// HMAC com o AUTH_SECRET: dá para contar pedidos sem guardar e-mail/IP legíveis.
const keyedHash = (purpose: string, value: string) =>
  createHmac("sha256", getAuthSecret()).update(`${purpose}:${value || "unknown"}`).digest("hex");
export const resetEmailHash = (email: string) => keyedHash("password-reset-email", email);
export const resetFingerprint = (ip: string) => keyedHash("password-reset-ip", ip);

export function passwordResetUrl(baseUrl: string, token: string) {
  // Token no fragmento (#): não vai para logs de servidor nem para o Referer.
  return `${baseUrl.replace(/\/$/, "")}/redefinir-senha#token=${encodeURIComponent(token)}`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function passwordResetEmailContent(input: { name: string; url: string }) {
  const name = escapeHtml(input.name);
  const url = escapeHtml(input.url);
  return {
    subject: "BancadaSoft — Redefinição de senha",
    html: `<div style="font-family:Arial,sans-serif;color:#10213b;max-width:600px;margin:auto"><h1 style="color:#0878f9">BancadaSoft</h1><p>Olá, ${name}.</p><p>Recebemos um pedido para redefinir a senha da sua conta.</p><p><a href="${url}" style="display:inline-block;background:#0878f9;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">DEFINIR NOVA SENHA</a></p><p>O link vale por 1 hora e só pode ser usado uma vez.</p><p>Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.</p><p>BancadaSoft<br>Encontrou. Pagou. Liberou.</p></div>`,
    text: `Olá, ${input.name}.\n\nRecebemos um pedido para redefinir a senha da sua conta.\n\nDefina uma nova senha:\n${input.url}\n\nO link vale por 1 hora e só pode ser usado uma vez.\n\nSe você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.\n\nBancadaSoft\nEncontrou. Pagou. Liberou.`,
  };
}

// Conta e registra o pedido. Feito ANTES da resposta e igual para qualquer
// e-mail, então o limite não revela se a conta existe.
export async function registerResetRequest(email: string, ip: string, now = new Date()) {
  const emailHash = resetEmailHash(email);
  const fingerprint = resetFingerprint(ip);
  const since = new Date(now.getTime() - PASSWORD_RESET_RATE_WINDOW_MS);
  const [byEmail, byIp] = await Promise.all([
    prisma.passwordResetRequest.count({ where: { emailHash, createdAt: { gte: since } } }),
    prisma.passwordResetRequest.count({ where: { fingerprint, createdAt: { gte: since } } }),
  ]);
  if (byEmail >= PASSWORD_RESET_MAX_PER_EMAIL || byIp >= PASSWORD_RESET_MAX_PER_IP) return { allowed: false as const };
  await prisma.passwordResetRequest.create({ data: { emailHash, fingerprint } });
  // Limpeza oportunista: registros fora da janela não servem mais para nada.
  await prisma.passwordResetRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * PASSWORD_RESET_RATE_WINDOW_MS) } } });
  return { allowed: true as const };
}

// Roda depois da resposta (after()). Conta inexistente ou inativa: não faz nada.
export async function issuePasswordReset(
  email: string,
  baseUrl: string,
  options: { apiKey?: string; from?: string; transport?: EmailTransport; now?: Date } = {},
) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, active: true } });
  if (!user || !user.active) return { status: "SKIPPED" as const };
  const { token, tokenHash, expiresAt } = createResetToken(options.now);
  // Um link novo invalida os anteriores ainda não usados.
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } }),
  ]);
  const url = passwordResetUrl(baseUrl, token);
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const from = options.from ?? process.env.EMAIL_FROM;
  if (!options.transport && (!apiKey?.trim() || !from?.trim())) {
    // Sem Resend configurado. Fora de produção o link vai para o console do
    // servidor, para permitir testar o fluxo localmente; em produção, nunca.
    if (process.env.NODE_ENV !== "production") console.info("[password-reset] Resend não configurado. Link de teste:", url);
    else console.error("[password-reset] Resend não configurado; e-mail não enviado.", { to: maskEmail(user.email) });
    return { status: "NOT_CONFIGURED" as const };
  }
  const transport = options.transport ?? new ResendEmailTransport(new Resend(apiKey!.trim()));
  try {
    await transport.send({ from: from!.trim(), to: user.email, ...passwordResetEmailContent({ name: user.name, url }) });
    return { status: "SENT" as const };
  } catch {
    console.error("[password-reset] Falha ao enviar o e-mail.", { to: maskEmail(user.email) });
    return { status: "FAILED" as const };
  }
}

export type ResetOutcome = "OK" | "INVALID_TOKEN";

export async function completePasswordReset(token: string, password: string, now = new Date()): Promise<ResetOutcome> {
  const tokenHash = hashResetToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true, user: { select: { active: true } } },
  });
  if (!record || record.usedAt || record.expiresAt <= now || !record.user.active) return "INVALID_TOKEN";
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    // Uso único mesmo com dois envios simultâneos: só um updateMany acha usedAt=null.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return "INVALID_TOKEN" as const;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: now } });
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId, id: { not: record.id } } });
    return "OK" as const;
  });
}
