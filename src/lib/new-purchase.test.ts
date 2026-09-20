import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NewPurchaseButton from "@/components/new-purchase-button";
import { needsGuestCheckoutRecovery, parseSavedCheckoutReference } from "./checkout-recovery";
import { clearStoredCheckout, showNewPurchaseButton } from "./new-purchase";
import { isRecoverableCheckoutOrder } from "./order-polling";
import type { OrderDTO } from "./dto";

const order = (status: string, paymentStatus: string) =>
  ({
    id: "order-1", publicToken: "tok-fake", status, totalCents: 2000, createdAt: new Date(), items: [],
    payment: { status: paymentStatus, amountCents: 2000, externalPaymentId: "pay-fake", pixPayload: "fake", qrCodeImage: null, expirationDate: new Date(), serverTime: new Date().toISOString() },
    fulfillment: null, events: [],
  }) as unknown as OrderDTO;

describe("botão Fazer nova compra", () => {
  it("é um botão visível e secundário (não o link pequeno)", () => {
    const html = renderToStaticMarkup(createElement(NewPurchaseButton, { onClick: () => undefined }));
    expect(html).toContain("<button");
    expect(html).toContain('class="new-purchase-button"');
    expect(html).not.toContain("new-purchase-link");
    expect(html).toContain("Fazer nova compra");
  });

  it("aparece na tela de entrega (DELIVERED com entrega carregada)", () => {
    expect(showNewPurchaseButton("DELIVERED", true)).toBe(true);
  });

  it("não aparece em PENDING_PAYMENT, com PIX expirado, pago sem entrega ou entrega ainda carregando", () => {
    expect(showNewPurchaseButton("PENDING_PAYMENT", false)).toBe(false);
    expect(showNewPurchaseButton(order("PENDING_PAYMENT", "PENDING").status, false)).toBe(false);
    expect(showNewPurchaseButton(order("PENDING_PAYMENT", "EXPIRED").status, false)).toBe(false);
    expect(showNewPurchaseButton("PAID", false)).toBe(false);
    expect(showNewPurchaseButton("PROCESSING", false)).toBe(false);
    expect(showNewPurchaseButton("DELIVERED", false)).toBe(false);
    expect(showNewPurchaseButton(undefined, false)).toBe(false);
  });

  it("no painel, fica logo abaixo de ACESSAR FERRAMENTA e só é renderizado pela regra da tela de entrega", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/checkout-panel.tsx"), "utf8");
    const cta = source.indexOf('"ACESSAR FERRAMENTA"');
    const button = source.indexOf("<NewPurchaseButton");
    const guidance = source.indexOf("Guarde essas informações");
    expect(cta).toBeGreaterThan(0);
    expect(button).toBeGreaterThan(cta);
    expect(button).toBeLessThan(guidance);
    expect(source.match(/<NewPurchaseButton/g)).toHaveLength(1);
    expect(source).toContain("showNewPurchaseButton(order.status, !!delivery)");
    expect(source).toContain("Acompanhar pedido em página separada");
  });

  it("o clique só mexe no estado local: o painel não faz nenhuma chamada de rede em startNewPurchase", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/checkout-panel.tsx"), "utf8");
    const start = source.indexOf("function startNewPurchase()");
    const body = source.slice(start, source.indexOf("\n  }\n", start));
    expect(body).toContain("clearActiveCheckout()");
    expect(body).not.toMatch(/fetch\(|method:/);
  });
});

describe("limpeza do pedido guardado", () => {
  const makeStorage = (initial: Record<string, string>) => {
    const data = new Map(Object.entries(initial));
    return { removeItem: vi.fn((key: string) => void data.delete(key)), has: (key: string) => data.has(key), data };
  };

  it("limpa SOMENTE a referência do pedido deste produto", () => {
    const storage = makeStorage({
      "bancadasoft:checkout:prod-a": JSON.stringify({ id: "order-1", publicToken: "tok-fake" }),
      "bancadasoft:checkout:prod-b": JSON.stringify({ id: "order-2", publicToken: "tok-fake-2" }),
      "bancadasoft:delivery:order-1": "fake-delivery-token-for-tests-0123456789",
    });
    clearStoredCheckout(storage, "bancadasoft:checkout:prod-a");
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    expect(storage.has("bancadasoft:checkout:prod-a")).toBe(false);
    expect(storage.has("bancadasoft:checkout:prod-b")).toBe(true);
    // o token usado por /acompanhar continua guardado
    expect(storage.has("bancadasoft:delivery:order-1")).toBe(true);
  });

  it("depois de limpar, atualizar a página não restaura o pedido antigo (nada guardado)", () => {
    const storage = makeStorage({ "bancadasoft:checkout:prod-a": JSON.stringify({ id: "order-1", publicToken: "tok-fake" }) });
    clearStoredCheckout(storage, "bancadasoft:checkout:prod-a");
    expect(storage.data.get("bancadasoft:checkout:prod-a") ?? null).toBeNull();
  });
});

describe("recuperação do pedido entregue continua funcionando", () => {
  it("ao atualizar a página, a referência guardada é lida e o pedido DELIVERED segue recuperável", () => {
    const saved = JSON.stringify({ id: "order-1", publicToken: "tok-fake", deliveryAccessToken: "x".repeat(40) });
    const ref = parseSavedCheckoutReference(saved);
    expect(ref).toMatchObject({ id: "order-1", publicToken: "tok-fake" });
    expect(needsGuestCheckoutRecovery(ref!)).toBe(false);
    expect(isRecoverableCheckoutOrder(order("DELIVERED", "PAID"))).toBe(true);
  });

  it("referência só com token de entrega ainda aciona a recuperação de convidado", () => {
    const ref = parseSavedCheckoutReference(JSON.stringify({ deliveryAccessToken: "y".repeat(40) }));
    expect(needsGuestCheckoutRecovery(ref!)).toBe(true);
  });

  it("o painel não altera o código de restauração nem o prazo: nenhuma constante de prazo local foi adicionada", () => {
    const source = readFileSync(path.resolve(__dirname, "../components/checkout-panel.tsx"), "utf8");
    expect(source).toContain("isRecoverableCheckoutOrder(payload.data)");
    expect(source).not.toMatch(/TTL|maxAge|Date\.now\(\)\s*-/);
  });
});
