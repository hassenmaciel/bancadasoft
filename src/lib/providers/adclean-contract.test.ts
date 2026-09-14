import { describe, expect, it } from "vitest";
import { buildAdcleanTicketContract } from "./adclean-contract";

describe("contrato futuro AdClean sem chamada externa", () => {
  it("prepara ticket de 168 horas com valor efetivamente pago e chave estável", () => {
    expect(buildAdcleanTicketContract("order-immutable", 1000)).toEqual({
      duracao_horas: 168,
      valor: 10,
      expira_em_dias: null,
      idempotency_key: "bancadasoft:order-immutable",
      external_order_id: "order-immutable",
      partner: "bancadasoft",
    });
  });
  it("rejeita valor ausente sem gerar outra chave", () => expect(() => buildAdcleanTicketContract("order-1", 0)).toThrow("ADCLEAN_PAID_AMOUNT_REQUIRED"));
});
