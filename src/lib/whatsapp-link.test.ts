import { describe, expect, it } from "vitest";
import { whatsappLink } from "./whatsapp-link";

describe("whatsappLink", () => {
  it("mantém o número já com 55 (13 e 12 dígitos)", () => {
    expect(whatsappLink("5511987654321")).toBe("https://wa.me/5511987654321");
    expect(whatsappLink("551132654321")).toBe("https://wa.me/551132654321");
  });

  it("acrescenta 55 a 10 ou 11 dígitos sem DDI, inclusive DDD 55", () => {
    expect(whatsappLink("11987654321")).toBe("https://wa.me/5511987654321");
    expect(whatsappLink("1132654321")).toBe("https://wa.me/551132654321");
    expect(whatsappLink("55987654321")).toBe("https://wa.me/5555987654321");
  });

  it("remove a máscara antes de normalizar", () => {
    expect(whatsappLink("(11) 98765-4321")).toBe("https://wa.me/5511987654321");
    expect(whatsappLink("+55 (11) 98765-4321")).toBe("https://wa.me/5511987654321");
  });

  it("devolve null para número inválido", () => {
    for (const value of ["123", "abc", "11111111111", "551111111111", "441198765432", "12345678901234"])
      expect(whatsappLink(value)).toBeNull();
  });

  it("devolve null quando ausente", () => {
    for (const value of [null, undefined, "", "   "]) expect(whatsappLink(value)).toBeNull();
  });
});
