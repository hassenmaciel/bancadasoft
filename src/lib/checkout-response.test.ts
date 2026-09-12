import { describe, expect, it } from "vitest";
import {
  CHECKOUT_FALLBACK_ERROR,
  checkoutErrorMessage,
  createCheckoutSubmissionGuard,
  readCheckoutResponse,
} from "./checkout-response";

describe("resposta segura do checkout", () => {
  it("lê uma resposta JSON de sucesso", async () => {
    const response = new Response(
      JSON.stringify({ ok: true, data: { id: "order-test" }, deliveryAccessToken: "token" }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
    await expect(readCheckoutResponse(response)).resolves.toMatchObject({
      ok: true,
      data: { id: "order-test" },
    });
  });

  it("trata body vazio sem executar response.json()", async () => {
    const response = new Response(null, { status: 500 });
    await expect(readCheckoutResponse(response)).resolves.toBeNull();
    expect(checkoutErrorMessage(response.status, null)).toBe(
      CHECKOUT_FALLBACK_ERROR,
    );
  });

  it("trata conteúdo não JSON e JSON inválido com mensagem amigável", async () => {
    const html = new Response("<html>erro</html>", {
      status: 500,
      headers: { "content-type": "text/html" },
    });
    const invalidJson = new Response("{", {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    await expect(readCheckoutResponse(html)).resolves.toBeNull();
    await expect(readCheckoutResponse(invalidJson)).resolves.toBeNull();
    expect(checkoutErrorMessage(500, null)).toBe(CHECKOUT_FALLBACK_ERROR);
  });

  it("mantém mensagens controladas para validação e indisponibilidade", () => {
    expect(checkoutErrorMessage(400, { code: "INVALID_CHECKOUT" })).toContain(
      "Revise os dados",
    );
    expect(
      checkoutErrorMessage(409, { code: "PRODUCT_UNAVAILABLE" }),
    ).toContain("temporariamente indisponível");
  });

  it("bloqueia duplo envio e libera uma tentativa posterior", () => {
    const guard = createCheckoutSubmissionGuard();
    expect(guard.acquire()).toBe(true);
    expect(guard.acquire()).toBe(false);
    guard.release();
    expect(guard.acquire()).toBe(true);
  });
});
