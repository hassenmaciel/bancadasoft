import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("jornada pública de cadastro", () => {
  it("expõe todos os campos obrigatórios e valida a confirmação no cliente", () => {
    const page = source("src/app/cadastro/page.tsx");

    for (const field of [
      "name",
      "email",
      "whatsapp",
      "cpfCnpj",
      "password",
      "passwordConfirmation",
    ]) {
      expect(page).toContain(`name="${field}"`);
    }
    expect(page).toContain('setError("As senhas não coincidem.")');
    expect(page).toContain('"/catalogo"');
  });

  it("liga login, cadastro e retorno ao site pelos destinos aprovados", () => {
    const login = source("src/app/login/page.tsx");
    const registration = source("src/app/cadastro/page.tsx");

    expect(login).toContain('href="/cadastro"');
    expect(login).toContain("Criar minha conta");
    expect(login).toContain('<Link href="/">← Voltar ao site</Link>');
    expect(registration).toContain('href="/login"');
    expect(registration).toContain("Entrar na minha conta");
    expect(registration).toContain('<Link href="/">← Voltar ao site</Link>');
  });

  it("mantém a resposta segura e clara para e-mail já existente", () => {
    // As mensagens de conflito vivem em registration-route.ts (PARTE 1-6 —
    // ativação de guest/PENDING_INVITE); route.ts é só a fiação com Prisma.
    const handler = source("src/lib/registration-route.ts");

    expect(handler).toContain(
      "Já existe uma conta com este e-mail. Entre na sua conta.",
    );
    expect(handler).toContain(
      "Não foi possível concluir o cadastro com os dados informados.",
    );
    expect(handler).toContain("status: 409");

    // passwordHash agora é lido (para checar PENDING_INVITE), mas nunca pode
    // sair na resposta/sessão: a seleção usada para a sessão não o inclui.
    const route = source("src/app/api/auth/register/route.ts");
    const sessionSelectBlock = route.slice(
      route.indexOf("sessionSelect = {"),
      route.indexOf("} as const;"),
    );
    expect(sessionSelectBlock).not.toContain("passwordHash");
  });
});
