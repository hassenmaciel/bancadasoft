// Banco em memória só para testes do saldo/ledger/revenda. Cobre apenas os
// métodos Prisma que esses módulos usam. $transaction faz rollback do estado
// inteiro quando a função lança, para os testes provarem atomicidade.
type Balance = { id: string; userId: string; balanceCents: number; enabled: boolean };
type Entry = {
  id: string;
  userId: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  sourceOrderId: string | null;
  externalReference: string | null;
  note: string | null;
  createdAt: Date;
};
type User = { id: string; role: string; active: boolean; passwordHash: string };
type ApiKey = {
  id: string;
  userId: string;
  tokenHash: string;
  label: string | null;
  active: boolean;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};
type Order = {
  id: string;
  customerId: string;
  providerProduct: { externalProductId: string; metadata: unknown; provider: { code: string } } | null;
};

export type FakeState = {
  users: User[];
  balances: Balance[];
  entries: Entry[];
  keys: ApiKey[];
  orders: Order[];
  resellerPriceCents: number | null;
};

let sequence = 0;
const id = (prefix: string) => `${prefix}-${++sequence}`;
const clone = (state: FakeState): FakeState => structuredClone(state);

export function createFakeLedgerDb(initial: Partial<FakeState> = {}) {
  let state: FakeState = {
    users: [],
    balances: [],
    entries: [],
    keys: [],
    orders: [],
    resellerPriceCents: null,
    ...structuredClone(initial),
  };
  const matches = (entry: Entry, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === "createdAt") return entry.createdAt >= (value as { gte: Date }).gte;
      return (entry as Record<string, unknown>)[key] === value;
    });

  const db = {
    get state() {
      return state;
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const snapshot = clone(state);
      try {
        return await fn(db);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    async $queryRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      const row = state.balances.find((b) => b.userId === values[0]);
      return row ? [{ id: row.id, balanceCents: row.balanceCents, enabled: row.enabled }] : [];
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return state.users.find((u) => u.id === where.id) ?? null;
      },
    },
    accountBalance: {
      async upsert({ where, update, create }: { where: { userId: string }; update: Partial<Balance>; create: Partial<Balance> & { userId: string } }) {
        const existing = state.balances.find((b) => b.userId === where.userId);
        if (existing) return Object.assign(existing, update);
        const row = { id: id("bal"), balanceCents: 0, enabled: false, ...create };
        state.balances.push(row);
        return row;
      },
      async findUnique({ where }: { where: { userId: string } }) {
        return state.balances.find((b) => b.userId === where.userId) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Balance> }) {
        const row = state.balances.find((b) => b.id === where.id);
        if (!row) throw new Error("NOT_FOUND");
        return Object.assign(row, data);
      },
    },
    accountLedgerEntry: {
      async findUnique({ where }: { where: { sourceOrderId: string } }) {
        return state.entries.find((e) => e.sourceOrderId === where.sourceOrderId) ?? null;
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return state.entries.find((e) => matches(e, where)) ?? null;
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return state.entries.filter((e) => matches(e, where)).length;
      },
      async create({ data }: { data: Omit<Entry, "id" | "createdAt" | "sourceOrderId" | "externalReference" | "note"> & Partial<Entry> }) {
        if (data.sourceOrderId && state.entries.some((e) => e.sourceOrderId === data.sourceOrderId))
          throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row: Entry = {
          sourceOrderId: null,
          externalReference: null,
          note: null,
          ...data,
          id: id("entry"),
          createdAt: new Date(),
        };
        state.entries.push(row);
        return row;
      },
    },
    resellerApiKey: {
      async findUnique({ where }: { where: { tokenHash: string } }) {
        const key = state.keys.find((k) => k.tokenHash === where.tokenHash);
        if (!key) return null;
        const user = state.users.find((u) => u.id === key.userId)!;
        return { ...key, user: { id: user.id, role: user.role, active: user.active } };
      },
      async findFirst({ where }: { where: { id: string; userId: string } }) {
        return state.keys.find((k) => k.id === where.id && k.userId === where.userId) ?? null;
      },
      async create({ data }: { data: { userId: string; tokenHash: string; label: string | null } }) {
        const row: ApiKey = { ...data, id: id("key"), active: true, revokedAt: null, lastUsedAt: null, createdAt: new Date() };
        state.keys.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<ApiKey> }) {
        const row = state.keys.find((k) => k.id === where.id);
        if (!row) throw new Error("NOT_FOUND");
        return Object.assign(row, data);
      },
    },
    providerProduct: {
      async findFirst() {
        return { product: { resellerPriceCents: state.resellerPriceCents } };
      },
    },
    order: {
      async findUnique({ where }: { where: { id: string } }) {
        const order = state.orders.find((o) => o.id === where.id);
        if (!order) return null;
        const customer = state.users.find((u) => u.id === order.customerId)!;
        return {
          customerId: order.customerId,
          customer: { passwordHash: customer.passwordHash },
          items: [{ providerProduct: order.providerProduct }],
        };
      },
    },
  };
  return db;
}

export type FakeLedgerDb = ReturnType<typeof createFakeLedgerDb>;
