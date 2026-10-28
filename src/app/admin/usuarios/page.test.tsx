import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { db } = vi.hoisted(() => ({ db: { user: { findMany: vi.fn() } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ id: "admin-1" })) }));
import UsersPage from "./page";

const user = (id: string, whatsapp: string | null) => ({
  id,
  name: `Técnico ${id}`,
  email: `${id}@example.test`,
  role: "USER",
  customerTier: "NORMAL",
  canUseBalanceAsPayment: false,
  balanceTopupBlocked: false,
  active: true,
  createdAt: new Date("2026-09-25T12:00:00.000Z"),
  whatsapp,
  // Mesmo que a consulta trouxesse o CPF, a página não o repassa.
  cpfCnpj: "52998224725",
  _count: { orders: 1 },
  accountBalance: null,
  resellerApiKeys: [],
});

describe("/admin/usuarios — dados pessoais fora do HTML", () => {
  it("não inclui número de WhatsApp nem CPF; só o indicador do botão", async () => {
    db.user.findMany.mockResolvedValue([user("a", "5511987654321"), user("b", null)]);
    const html = renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toMatch(/987654321|98765-4321|wa\.me/);
    expect(html).not.toMatch(/52998224725|529\.982\.247-25/);
    expect(html).toContain('<button type="button">WhatsApp</button>');
    expect(html).toContain('<button type="button" disabled="">Sem WhatsApp</button>');
    expect(db.user.findMany.mock.calls[0][0].select).not.toHaveProperty("cpfCnpj");
  });
});
