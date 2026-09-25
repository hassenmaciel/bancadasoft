import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

import ResellerApiPage from "./page";
import PublicHeader from "@/components/public-header";
import { RESELLER_API_ENDPOINT } from "@/components/reseller-api-docs";

const user = (role: string) => ({ id: "u1", email: "u1@example.test", name: "Pessoa Teste", role, customerTier: "NORMAL" });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("/minha-conta/api", () => {
  beforeEach(() => {
    requireUser.mockReset();
  });

  it("RESELLER vê a documentação completa", async () => {
    requireUser.mockResolvedValue(user("RESELLER"));
    const body = text(renderToStaticMarkup(await ResellerApiPage()));
    expect(body).toContain(`POST ${RESELLER_API_ENDPOINT}`);
    expect(body).toContain("Authorization: Bearer");
    expect(body).toContain("Content-Type: application/json");
    expect(body).toContain('"external_reference"');
    for (const field of ['"status": "COMPLETED"', '"ticket"', '"code"', '"charged_cents"', '"balance_cents"']) expect(body).toContain(field);
    expect(body).toContain("mesma external_reference");
    expect(body).toContain("Chave só no servidor");
    expect(body).toContain("Saldo insuficiente");
  });

  it("tabela de erros tem uma linha para cada status exigido", async () => {
    requireUser.mockResolvedValue(user("RESELLER"));
    const html = renderToStaticMarkup(await ResellerApiPage());
    const statuses = [...html.matchAll(/<tr><td>(\d{3})<\/td>/g)].map((m) => Number(m[1]));
    expect(statuses).toEqual(expect.arrayContaining([400, 401, 402, 429, 502, 503]));
  });

  it.each(["ADMIN", "USER", "CUSTOMER"])("%s é redirecionado para /minha-conta/saldo", async (role) => {
    requireUser.mockResolvedValue(user(role));
    await expect(ResellerApiPage()).rejects.toThrow("REDIRECT:/minha-conta/saldo");
  });

  it("sem sessão vai para o login com retorno à página", async () => {
    requireUser.mockImplementation(async () => {
      throw new Error("UNAUTHORIZED");
    });
    await expect(ResellerApiPage()).rejects.toThrow("REDIRECT:/login?next=/minha-conta/api");
  });
});

describe("menu do usuário logado", () => {
  const menu = (viewer: Parameters<typeof PublicHeader>[0]["viewer"]) => renderToStaticMarkup(<PublicHeader viewer={viewer} />);

  it("mostra o link da API só para RESELLER", () => {
    expect(menu({ name: "Pessoa", role: "RESELLER" })).toContain('href="/minha-conta/api"');
    for (const role of ["ADMIN", "USER", "CUSTOMER"] as const) {
      expect(menu({ name: "Pessoa", role })).not.toContain('href="/minha-conta/api"');
      expect(menu({ name: "Pessoa", role })).toContain('href="/minha-conta/saldo"');
    }
    expect(menu(null)).not.toContain('href="/minha-conta/api"');
  });
});
