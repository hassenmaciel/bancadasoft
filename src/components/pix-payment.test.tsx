import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaymentDTO } from "@/lib/dto";
import PixPayment from "./pix-payment";

// Dados FICTÍCIOS.
const WAIT_TEXT = "Após realizar o pagamento, aguarde nesta página. Seu acesso será liberado automaticamente.";

function render(status: PaymentDTO["status"], expiresInMs: number) {
  const serverTime = new Date().toISOString();
  const payment = {
    status,
    amountCents: 2000,
    externalPaymentId: null,
    pixPayload: "pix-ficticio",
    qrCodeImage: null,
    expirationDate: new Date(Date.parse(serverTime) + expiresInMs),
    serverTime,
  } as PaymentDTO;
  return renderToStaticMarkup(
    <PixPayment
      payment={payment}
      amountLabel="R$ 20,00"
      copied={false}
      onCopy={() => {}}
      onRenew={() => {}}
      renewing={false}
      renewError=""
      orderStatus="PENDING_PAYMENT"
      onCancel={() => {}}
      cancelling={false}
      cancelMessage=""
      onNewPurchase={() => {}}
    />,
  );
}

describe("destaque do aviso de espera do PIX", () => {
  it("PIX válido: classe de destaque no aviso, com o texto original", () => {
    const html = render("PENDING", 20 * 60_000);
    expect(html).toContain("Aguardando pagamento");
    expect(html).toContain(`<p class="checkout-guidance pix-wait-highlight">${WAIT_TEXT}</p>`);
  });

  it("PIX expirado: sem destaque e sem o aviso", () => {
    const html = render("EXPIRED", 20 * 60_000);
    expect(html).toContain("PIX expirado");
    expect(html).not.toContain("pix-wait-highlight");
    expect(html).not.toContain(WAIT_TEXT);
  });

  it("expiração pelo relógio do servidor também remove o destaque", () => {
    expect(render("PENDING", -1000)).not.toContain("pix-wait-highlight");
  });

  it("a classe só é aplicada uma vez no componente (não vaza para outros estados)", () => {
    const src = readFileSync(new URL("./pix-payment.tsx", import.meta.url), "utf8");
    expect(src.match(/pix-wait-highlight/g)).toHaveLength(1);
  });

  it("CSS: vermelho, pulsação por opacidade/borda e prefers-reduced-motion sem animação", () => {
    const css = readFileSync(new URL("../app/checkout.css", import.meta.url), "utf8");
    const rule = css.match(/\.pix-wait-highlight\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("border: 2px solid #dc2626");
    expect(rule).toContain("background: #fee2e2");
    expect(rule).toContain("color: #7f1d1d");
    expect(rule).toContain("animation: pix-wait-pulse 1.5s");
    const keyframes = css.match(/@keyframes pix-wait-pulse\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toMatch(/transform|width|height|margin|top|left/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.checkout-state > p\.pix-wait-highlight\s*\{\s*animation: none;/);
  });
});
