import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { issuePasswordReset, passwordResetRequestSchema, registerResetRequest } from "@/lib/password-reset";

// Mensagem única: nunca revela se o e-mail tem conta.
const GENERIC_MESSAGE = "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha.";

// Em produção o link usa sempre o domínio configurado no Admin, nunca o Host
// da requisição (evita envenenar o link com um Host forjado).
async function resetBaseUrl(request: Request) {
  if (process.env.NODE_ENV !== "production") return new URL(request.url).origin;
  const settings = await prisma.siteSettings.findUnique({ where: { id: "default" }, select: { domain: true } });
  return `https://${settings?.domain ?? "www.bancadasoft.com.br"}`;
}

export async function POST(request: Request) {
  const parsed = passwordResetRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 422 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = await registerResetRequest(parsed.data.email, ip);
  if (!limit.allowed)
    return NextResponse.json({ error: "Muitas solicitações. Tente novamente mais tarde." }, { status: 429 });
  const baseUrl = await resetBaseUrl(request);
  // Busca do usuário, token e e-mail rodam depois da resposta: o tempo de
  // resposta é o mesmo para e-mail cadastrado ou não.
  after(async () => {
    try {
      await issuePasswordReset(parsed.data.email, baseUrl);
    } catch {
      console.error("[password-reset] Falha ao processar o pedido de redefinição.");
    }
  });
  return NextResponse.json({ data: { message: GENERIC_MESSAGE } });
}
