import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CustomerBalancePanel, { BALANCE_DISABLED_MESSAGE, BALANCE_UNAVAILABLE_MESSAGE } from "./customer-balance-panel";
import { BALANCE_TOPUP_BLOCKED_MESSAGE } from "@/lib/commercial-pricing";
import type { CustomerBalanceView } from "@/lib/customer-balance";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/&amp;/g, "&");

const entries: CustomerBalanceView["entries"] = [
  { id: "e4", createdAt: new Date("2026-09-20T15:00:00Z"), type: "ADJUSTMENT", amountCents: -500, balanceAfterCents: 7000 },
  { id: "e3", createdAt: new Date("2026-09-19T15:00:00Z"), type: "REFUND", amountCents: 2500, balanceAfterCents: 7500 },
  { id: "e2", createdAt: new Date("2026-09-18T15:00:00Z"), type: "PURCHASE", amountCents: -2500, balanceAfterCents: 5000 },
  { id: "e1", createdAt: new Date("2026-09-17T15:00:00Z"), type: "TOPUP", amountCents: 7500, balanceAfterCents: 7500 },
];

describe("CustomerBalancePanel", () => {
  it("exibe o saldo formatado, o extrato em português com sinal e os links de recarga", () => {
    const html = renderToStaticMarkup(
      <CustomerBalancePanel
        view={{
          enabled: true,
          balanceCents: 7000,
          entries,
          topupOptions: [{ key: "v50", label: "Pacote R$ 50", priceCents: 5000, href: "/produto/recarga-de-saldo?variante=v50" }],
          topupBlocked: false,
        }}
      />,
    );
    const body = text(html);
    expect(body).toContain("Saldo atual R$ 70,00");
    expect(body).not.toContain(BALANCE_DISABLED_MESSAGE);
    const rows = [...html.matchAll(/<tr><td>.*?<\/tr>/g)].map((row) => text(row[0]).trim());
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/Ajuste -R\$ 5,00 R\$ 70,00$/);
    expect(rows[1]).toMatch(/Estorno \+R\$ 25,00 R\$ 75,00$/);
    expect(rows[2]).toMatch(/Compra -R\$ 25,00 R\$ 50,00$/);
    expect(rows[3]).toMatch(/Recarga \+R\$ 75,00 R\$ 75,00$/);
    expect(rows[3]).toContain("17/09/2026");
    expect(html).toContain('href="/produto/recarga-de-saldo?variante=v50"');
    expect(body).toContain("Pacote R$ 50 — R$ 50,00");
  });

  it("saldo ainda não ativado: mostra o aviso em vez do saldo, mas oferece a recarga", () => {
    const html = renderToStaticMarkup(
      <CustomerBalancePanel
        view={{
          enabled: false,
          balanceCents: null,
          entries: [],
          topupOptions: [{ key: "v15", label: "Recarga Mínima", priceCents: 1500, href: "/produto/recarga-de-saldo?variante=v15" }],
          topupBlocked: false,
        }}
      />,
    );
    const body = text(html);
    expect(body).toContain(BALANCE_DISABLED_MESSAGE);
    expect(BALANCE_DISABLED_MESSAGE).toBe("Saldo ainda não ativado. Ele é ativado automaticamente na sua primeira recarga.");
    expect(body).toContain("Recarregar");
    expect(body).toContain("Recarga Mínima — R$ 15,00");
    expect(body).toContain("Nenhuma movimentação ainda.");
  });

  it("recarga bloqueada pelo Admin: mensagem clara, sem pacote e sem preço", () => {
    const body = text(renderToStaticMarkup(
      <CustomerBalancePanel view={{ enabled: false, balanceCents: null, entries: [], topupOptions: [], topupBlocked: true }} />,
    ));
    expect(body).toContain(BALANCE_TOPUP_BLOCKED_MESSAGE);
    expect(body).toContain(BALANCE_UNAVAILABLE_MESSAGE);
    expect(body).not.toContain(BALANCE_DISABLED_MESSAGE);
    expect(body).not.toContain("R$");
    expect(body).not.toContain("Nenhum pacote");
  });

  it("não exibe nada administrativo (chave de API, token)", () => {
    const body = text(renderToStaticMarkup(
      <CustomerBalancePanel view={{ enabled: true, balanceCents: 0, entries, topupOptions: [], topupBlocked: false }} />,
    )).toLowerCase();
    for (const word of ["chave", "api", "token", "admin"]) expect(body).not.toContain(word);
  });

  it("saldo ativo e recarga bloqueada: mostra o saldo e a mensagem de bloqueio, sem pacotes", () => {
    const body = text(renderToStaticMarkup(
      <CustomerBalancePanel view={{ enabled: true, balanceCents: 1500, entries: [], topupOptions: [], topupBlocked: true }} />,
    ));
    expect(body).toContain("Saldo atual R$ 15,00");
    expect(body).toContain(BALANCE_TOPUP_BLOCKED_MESSAGE);
    expect(body).not.toContain(BALANCE_DISABLED_MESSAGE);
    expect(body).not.toContain(BALANCE_UNAVAILABLE_MESSAGE);
    expect(body).not.toContain("Nenhum pacote");
    expect(body).not.toContain(" — ");
  });
});
