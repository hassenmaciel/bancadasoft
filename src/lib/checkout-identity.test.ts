import { describe, expect, it } from "vitest";
import {
  buildCheckoutIdentitySummary,
  IncompleteCheckoutIdentityError,
  missingIdentityFields,
  resolveAuthenticatedCheckoutIdentity,
} from "./checkout-identity";

const completeAccount = {
  name: "Hassen Maciel",
  email: "hassen@example.com",
  cpfCnpj: "52998224725",
  whatsapp: "5511987654321",
};

describe("checkout do cliente logado (PARTE 3/4)", () => {
  it("conta completa não tem campos faltantes e some visível", () => {
    expect(missingIdentityFields(completeAccount)).toEqual([]);
    const summary = buildCheckoutIdentitySummary(completeAccount);
    expect(summary.complete).toBe(true);
    expect(summary.missing).toEqual([]);
  });

  it("resumo nunca expõe CPF, e-mail ou WhatsApp em texto puro", () => {
    const summary = buildCheckoutIdentitySummary(completeAccount);
    expect(summary.maskedCpf).toBe("***.***.***-25");
    expect(summary.maskedEmail).toBe("ha***@example.com");
    expect(summary.maskedWhatsapp).toBe("•••••-4321");
    expect(JSON.stringify(summary)).not.toContain(completeAccount.cpfCnpj);
    expect(JSON.stringify(summary)).not.toContain(completeAccount.whatsapp);
  });

  it("detecta CPF e WhatsApp ausentes independentemente", () => {
    expect(missingIdentityFields({ cpfCnpj: null, whatsapp: "5511987654321" })).toEqual(["cpfCnpj"]);
    expect(missingIdentityFields({ cpfCnpj: "52998224725", whatsapp: null })).toEqual(["whatsapp"]);
    expect(missingIdentityFields({ cpfCnpj: null, whatsapp: null })).toEqual(["cpfCnpj", "whatsapp"]);
  });

  it("conta completa: usa os dados da conta e ignora entrada do cliente", () => {
    const resolved = resolveAuthenticatedCheckoutIdentity(completeAccount, {
      cpfCnpj: "00000000000",
      whatsapp: "5500000000000",
    });
    expect(resolved).toMatchObject({
      name: completeAccount.name,
      email: completeAccount.email,
      cpfCnpj: completeAccount.cpfCnpj,
      whatsapp: completeAccount.whatsapp,
      accountUpdates: {},
    });
  });

  it("conta sem WhatsApp: aceita somente o campo faltante e marca para persistir", () => {
    const account = { ...completeAccount, whatsapp: null };
    const resolved = resolveAuthenticatedCheckoutIdentity(account, {
      whatsapp: "(11) 91234-5678",
    });
    expect(resolved.whatsapp).toBe("5511912345678");
    expect(resolved.cpfCnpj).toBe(completeAccount.cpfCnpj);
    expect(resolved.accountUpdates).toEqual({ whatsapp: "5511912345678" });
    expect(resolved.accountUpdates).not.toHaveProperty("cpfCnpj");
  });

  it("nunca inclui name/email/role/customerTier nas atualizações de conta", () => {
    const account = { ...completeAccount, cpfCnpj: null, whatsapp: null };
    const resolved = resolveAuthenticatedCheckoutIdentity(account, {
      cpfCnpj: "529.982.247-25",
      whatsapp: "11987654321",
    });
    expect(Object.keys(resolved.accountUpdates).sort()).toEqual(["cpfCnpj", "whatsapp"]);
    expect(resolved.accountUpdates).not.toHaveProperty("name");
    expect(resolved.accountUpdates).not.toHaveProperty("email");
    expect(resolved.accountUpdates).not.toHaveProperty("role");
    expect(resolved.accountUpdates).not.toHaveProperty("customerTier");
  });

  it("rejeita CPF inválido enviado para completar cadastro", () => {
    const account = { ...completeAccount, cpfCnpj: null };
    expect(() =>
      resolveAuthenticatedCheckoutIdentity(account, { cpfCnpj: "111.111.111-11" }),
    ).toThrow(IncompleteCheckoutIdentityError);
  });

  it("rejeita WhatsApp inválido enviado para completar cadastro", () => {
    const account = { ...completeAccount, whatsapp: null };
    expect(() =>
      resolveAuthenticatedCheckoutIdentity(account, { whatsapp: "123" }),
    ).toThrow(IncompleteCheckoutIdentityError);
  });

  it("erro de campos faltantes informa exatamente quais campos", () => {
    const account = { ...completeAccount, cpfCnpj: null, whatsapp: null };
    try {
      resolveAuthenticatedCheckoutIdentity(account, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IncompleteCheckoutIdentityError);
      expect((error as IncompleteCheckoutIdentityError).missing).toEqual(["cpfCnpj", "whatsapp"]);
    }
  });
});
