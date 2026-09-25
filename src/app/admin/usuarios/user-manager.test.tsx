import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import UserManager from "./user-manager";
import { isAdminRole, isResellerRole } from "@/lib/authorization";

const row = (role: string) => ({
  id: `u-${role}`,
  name: `Usuário ${role}`,
  email: `${role.toLowerCase()}@example.test`,
  role,
  customerTier: "NORMAL" as const,
  active: true,
  createdAt: "2026-09-25T12:00:00.000Z",
  orderCount: 0,
  balance: null,
  resellerKeys: [],
});

// Só o <select> de papel da tabela (o do formulário de criação tem name="role").
const tableRoleSelect = (html: string) => html.match(/<td><select>(?:(?!<\/select>).)*<\/select><\/td>/s)?.[0] ?? "";

describe("papel RESELLER na tela de usuários", () => {
  it("o select da tabela mostra RESELLER selecionado quando a role é RESELLER", () => {
    const html = renderToStaticMarkup(<UserManager rows={[row("RESELLER")]} currentAdminId="admin" />);
    const select = tableRoleSelect(html);
    expect(select).toContain('<option selected="">RESELLER</option>');
    expect(select).not.toContain('<option selected="">USER</option>');
  });

  it("as demais roles continuam selecionando a própria opção (CUSTOMER aparece como USER)", () => {
    for (const [role, shown] of [["ADMIN", "ADMIN"], ["USER", "USER"], ["CUSTOMER", "USER"]]) {
      const select = tableRoleSelect(renderToStaticMarkup(<UserManager rows={[row(role)]} currentAdminId="admin" />));
      expect(select).toContain(`<option selected="">${shown}</option>`);
      expect(select).toContain("<option>RESELLER</option>");
    }
  });

  it("o formulário de criação oferece RESELLER", () => {
    const html = renderToStaticMarkup(<UserManager rows={[]} currentAdminId="admin" />);
    expect(html).toContain('<option value="RESELLER">RESELLER</option>');
  });
});

describe("isResellerRole", () => {
  it("é true só para RESELLER, no mesmo padrão exato de isAdminRole", () => {
    expect(isResellerRole("RESELLER")).toBe(true);
    for (const role of ["ADMIN", "USER", "CUSTOMER", "reseller", "RESELLER ", ""]) expect(isResellerRole(role)).toBe(false);
    expect(isAdminRole("RESELLER")).toBe(false);
  });
});
