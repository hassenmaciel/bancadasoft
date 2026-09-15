import { describe, expect, it } from "vitest";
import { buildAdminOrderSearchWhere } from "./admin-order-search";

describe("busca administrativa de pedidos (PARTE 6/16)", () => {
  it("sem filtros retorna where vazio", () => {
    expect(buildAdminOrderSearchWhere({})).toEqual({});
  });

  it("busca livre cobre ID, token, nome, e-mail e produto", () => {
    const where = buildAdminOrderSearchWhere({ q: "unlocktool" });
    expect(where).toEqual({
      AND: [
        {
          OR: [
            { id: { contains: "unlocktool", mode: "insensitive" } },
            { publicToken: { contains: "unlocktool", mode: "insensitive" } },
            { customer: { name: { contains: "unlocktool", mode: "insensitive" } } },
            { customer: { email: { contains: "unlocktool", mode: "insensitive" } } },
            { items: { some: { product: { name: { contains: "unlocktool", mode: "insensitive" } } } } },
          ],
        },
      ],
    });
  });

  it("normaliza CPF/WhatsApp com máscara para busca por dígitos", () => {
    const where = buildAdminOrderSearchWhere({ q: "529.982.247-25" }) as { AND: Array<{ OR: unknown[] }> };
    const or = where.AND[0].OR;
    expect(or).toContainEqual({ customer: { cpfCnpj: { contains: "52998224725" } } });
    expect(or).toContainEqual({ customer: { whatsapp: { contains: "52998224725" } } });
  });

  it("não adiciona busca por dígitos para termos curtos (evita matches irrelevantes)", () => {
    const where = buildAdminOrderSearchWhere({ q: "a1" }) as { AND: Array<{ OR: unknown[] }> };
    const or = where.AND[0].OR;
    expect(or.some((clause) => JSON.stringify(clause).includes("cpfCnpj"))).toBe(false);
  });

  it("encontra pedido avulso/guest com os mesmos campos (sem estrutura paralela)", () => {
    const where = buildAdminOrderSearchWhere({ q: "guest@example.com" });
    expect(JSON.stringify(where)).toContain("guest@example.com");
  });

  it("combina busca livre com filtros de status", () => {
    const where = buildAdminOrderSearchWhere({
      q: "cliente",
      orderStatus: "DELIVERED",
      paymentStatus: "PAID",
      fulfillmentStatus: "FULFILLED",
    });
    expect(where).toEqual({
      AND: [
        expect.objectContaining({ OR: expect.any(Array) }),
        { status: "DELIVERED" },
        { payment: { status: "PAID" } },
        { fulfillment: { status: "FULFILLED" } },
      ],
    });
  });

  it("ignora filtros com valor ALL", () => {
    expect(
      buildAdminOrderSearchWhere({ orderStatus: "ALL", paymentStatus: "ALL", fulfillmentStatus: "ALL" }),
    ).toEqual({});
  });

  it("filtro isolado de status funciona sem termo de busca", () => {
    expect(buildAdminOrderSearchWhere({ orderStatus: "PENDING_PAYMENT" })).toEqual({
      AND: [{ status: "PENDING_PAYMENT" }],
    });
  });
});
