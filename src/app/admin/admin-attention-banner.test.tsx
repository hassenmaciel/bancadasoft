import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ order: { count: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { attentionSummary } from "@/lib/admin-attention";
import { AttentionBannerView, loadAttentionAlerts } from "./admin-attention-banner";

describe("AdminAttentionBanner", () => {
  beforeEach(() => { db.order.count.mockReset(); });

  it("não renderiza nada sem alertas", () => {
    expect(renderToStaticMarkup(<AttentionBannerView alerts={[]} />)).toBe("");
  });

  it("uma linha por alerta com contagem, texto e link para a lista filtrada, role=status", () => {
    const html = renderToStaticMarkup(
      <AttentionBannerView alerts={attentionSummary({ STUCK: 3, PROVIDER_REJECTED: 1 })} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("<b>3</b> pagos parados em processamento além do prazo");
    expect(html).toContain('href="/admin/pedidos?attention=STUCK"');
    expect(html).toContain("<b>1</b> rejeitados pelo fornecedor");
    expect(html).toContain('href="/admin/pedidos?attention=PROVIDER_REJECTED"');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("se a consulta falhar, devolve lista vazia (o admin nunca quebra)", async () => {
    db.order.count.mockImplementation(async () => { throw new Error("db down"); });
    await expect(loadAttentionAlerts()).resolves.toEqual([]);
  });

  it("com contagens zero não há alertas", async () => {
    db.order.count.mockResolvedValue(0);
    await expect(loadAttentionAlerts()).resolves.toEqual([]);
  });
});
