import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ current: {} as Record<string, Record<string, unknown>> }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, key) => prismaMock.current[key as string] }) }));

import {
  RESELLER_UNKNOWN_PRODUCT_ID,
  RESELLER_UNKNOWN_PRODUCT_NAME,
  buildResellerPurchaseWhere,
  buildResellerSales,
  buildStatsOrderWhere,
  buildStatusBreakdownWhere,
  buildTopupOrderWhere,
  getAdminStatistics,
  getCustomerBalances,
  getCustomerHistory,
  mergeResellerIntoCustomerGroups,
  orderCountsAsSale,
  parseBalanceSort,
  parseStatsPeriod,
  paymentMethodLabel,
  periodStart,
  rankCustomers,
  rankProducts,
  refundReferencesFor,
  resellerSoldItems,
  statusBreakdown,
  summarizeResellerSales,
  summarizeTotals,
} from "./admin-statistics";

const now = new Date("2026-10-18T12:00:00Z");
const notRefunded = { NOT: { payment: { is: { status: "REFUNDED" } } } };

describe("período", () => {
  it("aceita 7, 30, 90 e all; o resto cai em 30", () => {
    expect(parseStatsPeriod("7")).toBe("7");
    expect(parseStatsPeriod("90")).toBe("90");
    expect(parseStatsPeriod("all")).toBe("all");
    expect(parseStatsPeriod(undefined)).toBe("30");
    expect(parseStatsPeriod("365")).toBe("30");
    expect(parseStatsPeriod(["7", "90"])).toBe("30");
  });
  it("calcula o início do período; all não tem limite", () => {
    expect(periodStart("7", now)).toEqual(new Date("2026-10-11T12:00:00Z"));
    expect(periodStart("30", now)).toEqual(new Date("2026-09-18T12:00:00Z"));
    expect(periodStart("all", now)).toBeNull();
  });
});

describe("recorte de pedidos", () => {
  it("só conta pagos/entregues, exclui teste (mock), reembolsados e recargas, com data", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    expect(buildStatsOrderWhere(start)).toEqual({
      AND: [
        { status: { in: ["PAID", "PROCESSING", "FULFILLED", "DELIVERED"] } },
        { NOT: { payment: { is: { provider: "mock" } } } },
        notRefunded,
        { items: { none: { product: { type: "BALANCE_TOPUP" } } } },
        { createdAt: { gte: start } },
      ],
    });
  });
  it("sem data quando o período é tudo", () => {
    const where = buildStatsOrderWhere(null) as { AND: unknown[] };
    expect(where.AND).toHaveLength(4);
    expect(JSON.stringify(where)).not.toContain("CANCELLED");
  });
  it("quadro de status exclui CANCELLED e reembolsados", () => {
    const where = buildStatusBreakdownWhere(null) as { AND: unknown[] };
    expect(where.AND[0]).toEqual({ status: { not: "CANCELLED" } });
    expect(where.AND).toContainEqual(notRefunded);
  });
  it("recargas usam o recorte inverso de produto, também sem reembolsadas", () => {
    const where = buildTopupOrderWhere(null) as { AND: unknown[] };
    expect(where.AND).toContainEqual({ items: { some: { product: { type: "BALANCE_TOPUP" } } } });
    expect(where.AND).toContainEqual({ NOT: { payment: { is: { provider: "mock" } } } });
    expect(where.AND).toContainEqual(notRefunded);
  });
});

describe("pedido pago e depois reembolsado", () => {
  const order = (paymentStatus: string, status = "DELIVERED") =>
    ({ status, payment: { provider: "asaas", status: paymentStatus }, items: [{ product: { type: "TOOL" } }] }) as never;

  it("pedido pago normal entra; reembolsado (Order ainda DELIVERED) não entra", () => {
    expect(orderCountsAsSale(order("PAID"))).toBe(true);
    expect(orderCountsAsSale(order("REFUNDED"))).toBe(false);
    expect(orderCountsAsSale(order("REFUNDED", "PAID"))).toBe(false);
  });
  it("o filtro em memória segue as mesmas regras do where (teste, recarga, status)", () => {
    expect(orderCountsAsSale({ status: "PAID", payment: { provider: "mock", status: "PAID" }, items: [] } as never)).toBe(false);
    expect(orderCountsAsSale({ status: "PAID", payment: { provider: "asaas", status: "PAID" }, items: [{ product: { type: "BALANCE_TOPUP" } }] } as never)).toBe(false);
    expect(orderCountsAsSale({ status: "CANCELLED", payment: { provider: "balance", status: "PAID" }, items: [] } as never)).toBe(false);
    expect(orderCountsAsSale({ status: "PAID", payment: { provider: "balance", status: "PAID" }, items: [] } as never)).toBe(true);
  });
  it("todas as consultas de totais, rankings e status recebem o filtro de reembolso", async () => {
    const order = { aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { totalCents: null } })), groupBy: vi.fn(async () => []) };
    const orderItem = { findMany: vi.fn(async () => []) };
    prismaMock.current = { order, orderItem, accountLedgerEntry: { findMany: vi.fn(async () => []) }, user: { findMany: vi.fn() } };
    await getAdminStatistics("all", now);
    const wheres = [
      ...order.aggregate.mock.calls.map((call) => (call as unknown as [{ where: unknown }])[0].where),
      ...order.groupBy.mock.calls.map((call) => (call as unknown as [{ where: unknown }])[0].where),
      ...orderItem.findMany.mock.calls.map((call) => (call as unknown as [{ where: { order: unknown } }])[0].where.order),
    ];
    expect(wheres).toHaveLength(5);
    for (const where of wheres) expect((where as { AND: unknown[] }).AND).toContainEqual(notRefunded);
  });
});

describe("agregações", () => {
  const groups = [
    { customerId: "a", _sum: { totalCents: 5000 }, _count: { _all: 1 } },
    { customerId: "b", _sum: { totalCents: 3000 }, _count: { _all: 4 } },
    { customerId: "c", _sum: { totalCents: null }, _count: { _all: 4 } },
  ];
  const users = [{ id: "a", name: "Ana", email: "a@x" }, { id: "b", name: "Bia", email: "b@x" }];

  it("ranking de clientes por valor e por quantidade (desempate pelo outro critério)", () => {
    expect(rankCustomers(groups, users, "value").map((r) => r.customerId)).toEqual(["a", "b", "c"]);
    expect(rankCustomers(groups, users, "count").map((r) => r.customerId)).toEqual(["b", "c", "a"]);
    expect(rankCustomers(groups, users, "value")[2]).toEqual({ customerId: "c", name: "—", email: "", totalCents: 0, orderCount: 4 });
    expect(rankCustomers(groups, users, "value", 1)).toHaveLength(1);
  });

  it("ranking de produtos soma quantidade × preço unitário", () => {
    const items = [
      { productId: "p1", quantity: 1, unitPriceCents: 10000, product: { name: "UnlockTool" } },
      { productId: "p2", quantity: 5, unitPriceCents: 500, product: { name: "Créditos" } },
      { productId: "p1", quantity: 2, unitPriceCents: 9000, product: { name: "UnlockTool" } },
    ];
    expect(rankProducts(items, "value")).toEqual([
      { productId: "p1", name: "UnlockTool", quantity: 3, totalCents: 28000, orderCount: 2 },
      { productId: "p2", name: "Créditos", quantity: 5, totalCents: 2500, orderCount: 1 },
    ]);
    expect(rankProducts(items, "quantity").map((r) => r.productId)).toEqual(["p2", "p1"]);
    expect(rankProducts([], "value")).toEqual([]);
  });

  it("totais e ticket médio; zero pedidos não divide por zero", () => {
    expect(summarizeTotals({ _count: { _all: 3 }, _sum: { totalCents: 1000 } })).toEqual({ paidOrders: 3, revenueCents: 1000, averageTicketCents: 333 });
    expect(summarizeTotals({ _count: { _all: 0 }, _sum: { totalCents: null } })).toEqual({ paidOrders: 0, revenueCents: 0, averageTicketCents: 0 });
  });

  it("pedidos por status preenche zeros e omite CANCELLED", () => {
    const rows = statusBreakdown([{ status: "DELIVERED", _count: { _all: 2 } }] as never);
    expect(rows.find((r) => r.status === "DELIVERED")?.count).toBe(2);
    expect(rows.find((r) => r.status === "PAID")?.count).toBe(0);
    expect(rows.map((r) => r.status)).not.toContain("CANCELLED");
  });

  it("forma de pagamento a partir do provider", () => {
    expect(paymentMethodLabel("balance")).toBe("Saldo");
    expect(paymentMethodLabel("asaas")).toBe("PIX");
    expect(paymentMethodLabel("mock")).toBe("PIX (teste)");
    expect(paymentMethodLabel(undefined)).toBe("—");
  });

  it("ordenação do saldo aceita só asc/desc", () => {
    expect(parseBalanceSort("asc")).toBe("asc");
    expect(parseBalanceSort("x")).toBe("desc");
    expect(parseBalanceSort(undefined)).toBe("desc");
  });
});

describe("vendas da API de revenda", () => {
  const at = new Date("2026-10-10T10:00:00Z");
  const purchase = (id: string, userId: string, amountCents: number, ref: string, note: string | null = "Revenda AdClean ticket-168h") =>
    ({ id, userId, amountCents, externalReference: ref, note, createdAt: at });
  const links = [{ externalProductId: "ticket-168h", provider: { code: "adclean" }, product: { id: "p-ticket", name: "AdClean Ticket 168h" } }];

  it("só lança PURCHASE com externalReference e sem sourceOrderId (nunca o débito de pedido da loja)", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    expect(buildResellerPurchaseWhere(start)).toEqual({
      type: "PURCHASE", sourceOrderId: null, externalReference: { not: null }, createdAt: { gte: start },
    });
    expect(buildResellerPurchaseWhere(null, "u1")).toEqual({ type: "PURCHASE", sourceOrderId: null, externalReference: { not: null }, userId: "u1" });
  });

  it("venda da API entra no faturamento pelo valor em módulo e identifica o produto pelo note", () => {
    const sales = buildResellerSales([purchase("e1", "u1", -2500, "ref-1")], [], links);
    expect(sales).toEqual([expect.objectContaining({ amountCents: 2500, refunded: false, productId: "p-ticket", productName: "AdClean Ticket 168h" })]);
    expect(summarizeResellerSales(sales)).toEqual({ paidOrders: 1, revenueCents: 2500, averageTicketCents: 2500 });
  });

  it("venda da API com REFUND (refund:<referência>, mesmo usuário) não entra", () => {
    const purchases = [purchase("e1", "u1", -2500, "ref-1"), purchase("e2", "u1", -4000, "ref-2"), purchase("e3", "u2", -1000, "ref-1")];
    expect(refundReferencesFor(purchases)).toEqual(["refund:ref-1", "refund:ref-2", "refund:ref-1"]);
    const sales = buildResellerSales(purchases, [{ userId: "u1", externalReference: "refund:ref-1" }], links);
    expect(sales.map((s) => [s.entryId, s.refunded])).toEqual([["e1", true], ["e2", false], ["e3", false]]);
    expect(summarizeResellerSales(sales).revenueCents).toBe(5000);
    expect(resellerSoldItems(sales).map((item) => item.unitPriceCents)).toEqual([4000, 1000]);
    expect(mergeResellerIntoCustomerGroups([], sales)).toEqual([
      { customerId: "u1", _sum: { totalCents: 4000 }, _count: { _all: 1 } },
      { customerId: "u2", _sum: { totalCents: 1000 }, _count: { _all: 1 } },
    ]);
  });

  it("produto não identificado vai para o grupo 'Venda via API de revenda'", () => {
    const sales = buildResellerSales([purchase("e1", "u1", -900, "ref-1", "Revenda heartunlocks 999")], [], links);
    expect(sales[0]).toMatchObject({ productId: RESELLER_UNKNOWN_PRODUCT_ID, productName: RESELLER_UNKNOWN_PRODUCT_NAME });
    const unlinked = buildResellerSales([purchase("e2", "u1", -900, "ref-2")], [], [{ ...links[0], product: null }]);
    expect(unlinked[0].productName).toBe(RESELLER_UNKNOWN_PRODUCT_NAME);
  });

  it("soma ao cliente da loja sem duplicar: pedido e venda da API são registros diferentes", () => {
    const store = [{ customerId: "u1", _sum: { totalCents: 7000 }, _count: { _all: 2 } }];
    const sales = buildResellerSales([purchase("e1", "u1", -2500, "ref-1")], [], links);
    expect(mergeResellerIntoCustomerGroups(store, sales)).toEqual([{ customerId: "u1", _sum: { totalCents: 9500 }, _count: { _all: 3 } }]);
    expect(store[0]._sum.totalCents).toBe(7000);
  });
});

describe("getAdminStatistics", () => {
  let ledgerFindMany: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    ledgerFindMany = vi.fn(async ({ where }: { where: { type: string } }) =>
      where.type === "PURCHASE"
        ? [{ id: "e1", userId: "u2", amountCents: -2500, externalReference: "ref-1", note: "Revenda AdClean ticket-168h", createdAt: now },
           { id: "e2", userId: "u1", amountCents: -1000, externalReference: "ref-2", note: "Revenda AdClean ticket-168h", createdAt: now }]
        : [{ userId: "u1", externalReference: "refund:ref-2" }]);
    prismaMock.current = {
      order: {
        aggregate: vi.fn(async ({ where }: { where: unknown }) =>
          JSON.stringify(where).includes('"some"')
            ? { _count: { _all: 1 }, _sum: { totalCents: 10000 } }
            : { _count: { _all: 2 }, _sum: { totalCents: 7000 } }),
        groupBy: vi.fn(async ({ by }: { by: string[] }) =>
          by[0] === "status"
            ? [{ status: "PAID", _count: { _all: 2 } }]
            : [{ customerId: "u1", _sum: { totalCents: 7000 }, _count: { _all: 2 } }]),
      },
      orderItem: { findMany: vi.fn(async () => [{ productId: "p1", quantity: 2, unitPriceCents: 3500, product: { name: "Tool" } }]) },
      accountLedgerEntry: { findMany: ledgerFindMany },
      providerProduct: { findMany: vi.fn(async () => [{ externalProductId: "ticket-168h", provider: { code: "adclean" }, product: { id: "p-ticket", name: "Ticket" } }]) },
      user: { findMany: vi.fn(async () => [{ id: "u1", name: "Ana", email: "a@x" }, { id: "u2", name: "Bia", email: "b@x" }]) },
    };
  });

  it("aplica o mesmo recorte do período em todas as consultas", async () => {
    await getAdminStatistics("7", now);
    const start = periodStart("7", now);
    const order = prismaMock.current.order as Record<string, ReturnType<typeof vi.fn>>;
    expect(order.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: buildStatsOrderWhere(start) }));
    expect(order.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["customerId"], where: buildStatsOrderWhere(start) }));
    expect(prismaMock.current.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { order: buildStatsOrderWhere(start) } }));
    expect(ledgerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: buildResellerPurchaseWhere(start) }));
    expect(ledgerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "REFUND", externalReference: { in: ["refund:ref-1", "refund:ref-2"] } } }));
  });

  it("faturamento bruto = loja + API não estornada; rankings incluem a API", async () => {
    const data = await getAdminStatistics("all", now);
    expect(data.store).toEqual({ paidOrders: 2, revenueCents: 7000, averageTicketCents: 3500 });
    expect(data.reseller).toEqual({ paidOrders: 1, revenueCents: 2500, averageTicketCents: 2500 });
    expect(data.totals).toEqual({ paidOrders: 3, revenueCents: 9500, averageTicketCents: 3167 });
    expect(data.topups).toEqual({ paidOrders: 1, revenueCents: 10000, averageTicketCents: 10000 });
    expect(data.customersByValue.map((r) => [r.name, r.totalCents, r.orderCount])).toEqual([["Ana", 7000, 2], ["Bia", 2500, 1]]);
    expect(data.productsByValue.map((r) => [r.name, r.totalCents])).toEqual([["Tool", 7000], ["Ticket", 2500]]);
  });

  it("não consulta usuários quando não há vendas", async () => {
    (prismaMock.current.order as Record<string, ReturnType<typeof vi.fn>>).groupBy.mockResolvedValue([]);
    ledgerFindMany.mockResolvedValue([]);
    const data = await getAdminStatistics("all", now);
    expect(prismaMock.current.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.current.providerProduct.findMany).not.toHaveBeenCalled();
    expect(data.customersByCount).toEqual([]);
    expect(data.totals.revenueCents).toBe(7000);
  });

  it("lista de saldos ordena por balanceCents na direção pedida", async () => {
    const findMany = vi.fn(async () => []);
    prismaMock.current = { accountBalance: { findMany } };
    await getCustomerBalances("asc");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ balanceCents: "asc" }, { updatedAt: "desc" }] }));
  });
});

describe("getCustomerHistory", () => {
  it("marca pedidos reembolsados e vendas da API estornadas, e o total bate com as estatísticas", async () => {
    const tool = { name: "Tool", type: "TOOL" };
    prismaMock.current = {
      user: {
        findUnique: vi.fn(async () => ({
          id: "u1", name: "Ana", orders: [
            { id: "o1", status: "DELIVERED", totalCents: 5000, payment: { provider: "asaas", status: "PAID" }, items: [{ product: tool }] },
            { id: "o2", status: "DELIVERED", totalCents: 3000, payment: { provider: "asaas", status: "REFUNDED" }, items: [{ product: tool }] },
          ], ledgerEntries: [],
        })),
      },
      accountLedgerEntry: {
        findMany: vi.fn(async ({ where }: { where: { type: string } }) =>
          where.type === "PURCHASE"
            ? [{ id: "e1", userId: "u1", amountCents: -2000, externalReference: "r1", note: null, createdAt: now },
               { id: "e2", userId: "u1", amountCents: -900, externalReference: "r2", note: null, createdAt: now }]
            : [{ userId: "u1", externalReference: "refund:r2" }]),
      },
      providerProduct: { findMany: vi.fn(async () => []) },
    };
    const history = await getCustomerHistory("u1");
    expect(history?.orders.map((o) => [o.id, o.countsAsSale])).toEqual([["o1", true], ["o2", false]]);
    expect(history?.resellerSales.map((s) => [s.entryId, s.refunded])).toEqual([["e1", false], ["e2", true]]);
    expect(history?.countedCents).toBe(7000);
    expect(prismaMock.current.accountLedgerEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: buildResellerPurchaseWhere(null, "u1") }));
  });

  it("cliente inexistente devolve null", async () => {
    prismaMock.current = { user: { findUnique: vi.fn(async () => null) }, accountLedgerEntry: { findMany: vi.fn(async () => []) } };
    expect(await getCustomerHistory("x")).toBeNull();
  });
});
