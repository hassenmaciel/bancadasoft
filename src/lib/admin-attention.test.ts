import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ order: { count: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import {
  ATTENTION_KEYS,
  ATTENTION_LABELS,
  MANUAL_REVIEW_DAYS,
  STUCK_LICENSE_HOURS,
  STUCK_OTHER_HOURS,
  attentionSummary,
  buildAttentionWhere,
  getAttentionCounts,
  parseAttentionKey,
} from "./admin-attention";
import { LICENSE_SUCCESS_MANUAL_REVIEW_NOTE } from "./unlocktool-license";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const json = (value: unknown) => JSON.stringify(value);

describe("constantes", () => {
  it("valores editáveis padrão", () => {
    expect(STUCK_LICENSE_HOURS).toBe(26);
    expect(STUCK_OTHER_HOURS).toBe(2);
    expect(MANUAL_REVIEW_DAYS).toBe(3);
  });
});

describe("builders de where", () => {
  it("todos excluem CANCELLED", () => {
    for (const key of ATTENTION_KEYS) {
      expect(json(buildAttentionWhere(key, NOW)), key).toContain("CANCELLED");
    }
  });

  it("FULFILLMENT_FAILED / PROVIDER_FAILED / NO_FULFILLMENT", () => {
    expect(buildAttentionWhere("FULFILLMENT_FAILED", NOW)).toEqual({
      AND: [{ status: { notIn: ["CANCELLED"] } }, { fulfillment: { is: { status: "FAILED" } } }],
    });
    expect(buildAttentionWhere("PROVIDER_FAILED", NOW)).toEqual({
      AND: [{ status: { notIn: ["CANCELLED"] } }, { providerOrders: { some: { status: "FAILED" } } }],
    });
    expect(buildAttentionWhere("NO_FULFILLMENT", NOW)).toEqual({
      AND: [
        { status: { notIn: ["CANCELLED"] } },
        { payment: { status: "PAID" } },
        { fulfillment: { is: null } },
      ],
    });
  });

  it("STUCK: pago, fora de DELIVERED/CANCELLED, limite de 26 h para licença UnlockTool e 2 h para os demais", () => {
    const where = buildAttentionWhere("STUCK", NOW) as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ status: { notIn: ["DELIVERED", "CANCELLED"] } });
    expect(where.AND[1]).toEqual({ payment: { status: "PAID" } });
    const text = json(where);
    expect(text).toContain(hoursAgo(26).toISOString());
    expect(text).toContain(hoursAgo(2).toISOString());
    expect(text).toContain('"brand":{"name":"UnlockTool"},"type":"LICENSE"');
    expect(text).toContain('"NOT":{"items"');
    expect(text).toContain('"in":["QUEUED","PROCESSING"]');
  });

  it("STUCK: 25 h de licença ainda não passa do limite, 27 h passa; 3 h de outro produto passa, 1 h não", () => {
    const cutoffLicense = hoursAgo(STUCK_LICENSE_HOURS).getTime();
    const cutoffOther = hoursAgo(STUCK_OTHER_HOURS).getTime();
    expect(hoursAgo(25).getTime() < cutoffLicense).toBe(false);
    expect(hoursAgo(27).getTime() < cutoffLicense).toBe(true);
    expect(hoursAgo(3).getTime() < cutoffOther).toBe(true);
    expect(hoursAgo(1).getTime() < cutoffOther).toBe(false);
  });

  it("MANUAL_REVIEW: DELIVERED, nota da licença sem retorno e janela de 3 dias", () => {
    expect(buildAttentionWhere("MANUAL_REVIEW", NOW)).toEqual({
      AND: [
        { status: { notIn: ["CANCELLED"] } },
        { status: "DELIVERED" },
        {
          events: {
            some: {
              note: { contains: LICENSE_SUCCESS_MANUAL_REVIEW_NOTE },
              createdAt: { gte: new Date(NOW.getTime() - 3 * 86_400_000) },
            },
          },
        },
      ],
    });
    expect(LICENSE_SUCCESS_MANUAL_REVIEW_NOTE).toContain("o fornecedor confirmou sucesso");
  });

  it("PROVIDER_REJECTED: FAILED com HEARTUNLOCKS_GATEWAY_422 ou PROVIDER_REJECTED", () => {
    expect(buildAttentionWhere("PROVIDER_REJECTED", NOW)).toEqual({
      AND: [
        { status: { notIn: ["CANCELLED"] } },
        {
          providerOrders: {
            some: {
              status: "FAILED",
              OR: [
                { lastError: { contains: "HEARTUNLOCKS_GATEWAY_422" } },
                { lastError: { contains: "PROVIDER_REJECTED" } },
              ],
            },
          },
        },
      ],
    });
  });
});

describe("parseAttentionKey", () => {
  it("aceita só chaves da lista fixa", () => {
    expect(parseAttentionKey("STUCK")).toBe("STUCK");
    expect(parseAttentionKey("stuck")).toBeUndefined();
    expect(parseAttentionKey("ALL")).toBeUndefined();
    expect(parseAttentionKey(undefined)).toBeUndefined();
    expect(parseAttentionKey(["STUCK"])).toBeUndefined();
  });
});

describe("getAttentionCounts", () => {
  beforeEach(() => db.order.count.mockReset());
  it("conta cada alerta em paralelo com o where do builder", async () => {
    db.order.count.mockResolvedValue(2);
    const counts = await getAttentionCounts();
    expect(db.order.count).toHaveBeenCalledTimes(ATTENTION_KEYS.length);
    expect(Object.keys(counts)).toEqual([...ATTENTION_KEYS]);
    expect(counts.STUCK).toBe(2);
  });
});

describe("attentionSummary", () => {
  it("não devolve alertas com contagem zero", () => {
    expect(attentionSummary({ STUCK: 0, PROVIDER_FAILED: 0 })).toEqual([]);
    expect(attentionSummary({})).toEqual([]);
  });
  it("devolve key, count, label e href só dos alertas > 0, na ordem fixa", () => {
    expect(attentionSummary({ STUCK: 2, FULFILLMENT_FAILED: 1, NO_FULFILLMENT: 0 })).toEqual([
      {
        key: "FULFILLMENT_FAILED",
        count: 1,
        label: "pedidos com entrega falha",
        href: "/admin/pedidos?attention=FULFILLMENT_FAILED",
      },
      {
        key: "STUCK",
        count: 2,
        label: "pagos parados em processamento além do prazo",
        href: "/admin/pedidos?attention=STUCK",
      },
    ]);
  });
  it("textos finais", () => {
    expect(ATTENTION_LABELS.MANUAL_REVIEW).toBe(
      "licenças entregues sem retorno do fornecedor: conferir no painel do fornecedor",
    );
    expect(ATTENTION_LABELS.PROVIDER_REJECTED).toBe(
      "rejeitados pelo fornecedor: confira o saldo e os dados no painel do HeartUnlocks",
    );
  });
});
