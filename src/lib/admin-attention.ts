import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { LICENSE_SUCCESS_MANUAL_REVIEW_NOTE } from "./unlocktool-license";

// Alertas do Admin: TODOS derivados dos dados atuais (sem tabela, sem estado
// de "lido/dispensado"). Quando o pedido é resolvido, deixa de casar com o
// where e o alerta some sozinho. Os mesmos builders alimentam a contagem e a
// lista filtrada (/admin/pedidos?attention=KEY), então os números batem.

// Editáveis: prazo (em horas) para considerar um pedido pago "parado".
export const STUCK_LICENSE_HOURS = 26; // licença UnlockTool espera de 1 a 24 h
export const STUCK_OTHER_HOURS = 2;
// Janela (em dias) em que uma licença entregue sem retorno ainda pede conferência.
export const MANUAL_REVIEW_DAYS = 3;

export const ATTENTION_KEYS = [
  "FULFILLMENT_FAILED",
  "PROVIDER_FAILED",
  "NO_FULFILLMENT",
  "STUCK",
  "MANUAL_REVIEW",
  "PROVIDER_REJECTED",
] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export const parseAttentionKey = (value: unknown): AttentionKey | undefined =>
  typeof value === "string" && (ATTENTION_KEYS as readonly string[]).includes(value)
    ? (value as AttentionKey)
    : undefined;

const notCancelled: Prisma.OrderWhereInput = { status: { notIn: ["CANCELLED"] } };
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const licenseItem: Prisma.OrderWhereInput = {
  items: { some: { product: { brand: { name: "UnlockTool" }, type: "LICENSE" } } },
};

const inFlightBefore = (cutoff: Date): Prisma.OrderWhereInput => ({
  OR: [
    { fulfillment: { is: { status: { in: ["QUEUED", "PROCESSING"] }, updatedAt: { lt: cutoff } } } },
    {
      providerOrders: {
        some: { status: { in: ["QUEUED", "PROCESSING"] }, updatedAt: { lt: cutoff } },
      },
    },
  ],
});

export const attentionWhere = {
  FULFILLMENT_FAILED: (): Prisma.OrderWhereInput => ({
    AND: [notCancelled, { fulfillment: { is: { status: "FAILED" } } }],
  }),
  PROVIDER_FAILED: (): Prisma.OrderWhereInput => ({
    AND: [notCancelled, { providerOrders: { some: { status: "FAILED" } } }],
  }),
  NO_FULFILLMENT: (): Prisma.OrderWhereInput => ({
    AND: [notCancelled, { payment: { status: "PAID" } }, { fulfillment: { is: null } }],
  }),
  STUCK: (now: Date = new Date()): Prisma.OrderWhereInput => ({
    AND: [
      { status: { notIn: ["DELIVERED", "CANCELLED"] } },
      { payment: { status: "PAID" } },
      {
        OR: [
          { AND: [licenseItem, inFlightBefore(new Date(now.getTime() - STUCK_LICENSE_HOURS * HOUR_MS))] },
          {
            AND: [
              { NOT: licenseItem },
              inFlightBefore(new Date(now.getTime() - STUCK_OTHER_HOURS * HOUR_MS)),
            ],
          },
        ],
      },
    ],
  }),
  MANUAL_REVIEW: (now: Date = new Date()): Prisma.OrderWhereInput => ({
    AND: [
      notCancelled,
      { status: "DELIVERED" },
      {
        events: {
          some: {
            note: { contains: LICENSE_SUCCESS_MANUAL_REVIEW_NOTE },
            createdAt: { gte: new Date(now.getTime() - MANUAL_REVIEW_DAYS * DAY_MS) },
          },
        },
      },
    ],
  }),
  PROVIDER_REJECTED: (): Prisma.OrderWhereInput => ({
    AND: [
      notCancelled,
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
  }),
} satisfies Record<AttentionKey, (now?: Date) => Prisma.OrderWhereInput>;

export const buildAttentionWhere = (key: AttentionKey, now: Date = new Date()) =>
  attentionWhere[key](now);

export type AttentionCounts = Record<AttentionKey, number>;

// React.cache: dedupa dentro do mesmo request (layout + dashboard). As seis
// contagens rodam em paralelo.
export const getAttentionCounts = cache(async (): Promise<AttentionCounts> => {
  const now = new Date();
  const counts = await Promise.all(
    ATTENTION_KEYS.map((key) => prisma.order.count({ where: buildAttentionWhere(key, now) })),
  );
  return Object.fromEntries(ATTENTION_KEYS.map((key, i) => [key, counts[i]])) as AttentionCounts;
});

export const ATTENTION_LABELS: Record<AttentionKey, string> = {
  FULFILLMENT_FAILED: "pedidos com entrega falha",
  PROVIDER_FAILED: "pedidos com falha no fornecedor",
  NO_FULFILLMENT: "pagos sem entrega iniciada",
  STUCK: "pagos parados em processamento além do prazo",
  MANUAL_REVIEW: "licenças entregues sem retorno do fornecedor: conferir no painel do fornecedor",
  PROVIDER_REJECTED:
    "rejeitados pelo fornecedor: confira o saldo e os dados no painel do HeartUnlocks",
};

export type AttentionAlert = { key: AttentionKey; count: number; label: string; href: string };

export const attentionSummary = (counts: Partial<AttentionCounts>): AttentionAlert[] =>
  ATTENTION_KEYS.filter((key) => (counts[key] ?? 0) > 0).map((key) => ({
    key,
    count: counts[key] as number,
    label: ATTENTION_LABELS[key],
    href: `/admin/pedidos?attention=${key}`,
  }));
