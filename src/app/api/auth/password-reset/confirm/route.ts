import { NextResponse } from "next/server";
import { completePasswordReset, passwordResetConfirmSchema } from "@/lib/password-reset";

export async function POST(request: Request) {
  const parsed = passwordResetConfirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((issue) => issue.path[0] === "passwordConfirmation");
    return NextResponse.json(
      {
        error: mismatch
          ? "As senhas não coincidem."
          : "A senha precisa ter 12+ caracteres, com maiúscula, minúscula, número e símbolo.",
      },
      { status: 422 },
    );
  }
  const outcome = await completePasswordReset(parsed.data.token, parsed.data.password);
  if (outcome === "INVALID_TOKEN")
    return NextResponse.json(
      { error: "Link inválido ou expirado. Peça um novo link de redefinição." },
      { status: 400 },
    );
  return NextResponse.json({ data: { message: "Senha redefinida. Entre com a nova senha." } });
}
