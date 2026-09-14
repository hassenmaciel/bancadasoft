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
    const route = source("src/app/api/auth/register/route.ts");

    expect(route).toContain(
      "Já existe uma conta com este e-mail. Entre na sua conta.",
    );
    expect(route).toContain("status: 409");
    expect(route).not.toContain("passwordHash: true");
  });
});
