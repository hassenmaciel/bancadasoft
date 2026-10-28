import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, db, audit } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  db: { user: { findUnique: vi.fn() } },
  audit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/audit", () => ({ audit }));
import { POST } from "./route";

const ctx = { params: Promise.resolve({ id: "u1" }) };
const call = () => POST(new Request("https://test", { method: "POST" }), ctx);
const user = (whatsapp: string | null) => ({
  whatsapp,
  cpfCnpj: "52998224725",
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  _count: { orders: 3 },
  orders: [{ createdAt: new Date("2026-10-20T15:30:00.000Z") }],
  accountBalance: { enabled: true, balanceCents: 1250 },
});

describe("POST /api/admin/users/[id]/contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("recusa sem admin e não consulta nem audita", async () => {
    requireAdmin.mockRejectedValue(new Error("forbidden"));
    const response = await call();
    expect(response.status).toBe(403);
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("404 quando o usuário não existe, sem auditoria", async () => {
    db.user.findUnique.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });

  it("devolve a ficha com o link do WhatsApp", async () => {
    db.user.findUnique.mockResolvedValue(user("5511987654321"));
    const response = await call();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      whatsappLink: "https://wa.me/5511987654321",
      cpfCnpj: "52998224725",
      createdAt: "2026-09-01T10:00:00.000Z",
      orderCount: 3,
      lastOrderAt: "2026-10-20T15:30:00.000Z",
      balance: { enabled: true, balanceCents: 1250 },
    });
  });

  it("link nulo sem WhatsApp ou com número inválido; sem pedidos nem saldo", async () => {
    for (const whatsapp of [null, "123"]) {
      db.user.findUnique.mockResolvedValue({ ...user(whatsapp), _count: { orders: 0 }, orders: [], accountBalance: null });
      const { data } = await (await call()).json();
      expect(data).toMatchObject({ whatsappLink: null, orderCount: 0, lastOrderAt: null, balance: null });
    }
  });

  it("audita cada consulta sem dado pessoal no metadata", async () => {
    db.user.findUnique.mockResolvedValue(user("5511987654321"));
    await call();
    await call();
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenCalledWith("admin-1", "USER_CONTACT_VIEWED", "User", "u1");
    const args = JSON.stringify(audit.mock.calls);
    expect(args).not.toContain("987654321");
    expect(args).not.toContain("52998224725");
  });
});
