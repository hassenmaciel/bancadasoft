import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PENDING_INVITE_HASH } from "@/lib/account-activation";
import { creditTopup, formatBRL } from "@/lib/account-balance";
import type {
  ProviderAdapter,
  ProviderBalance,
  ProviderCatalogItem,
  ProviderHealth,
  ProviderOrderInput,
  ProviderOrderResult,
} from "./types";

// Provider interno da "Recarga de Saldo": 100% local, sem HTTP. Entra no
// fluxo normal Payment PAID -> executeFulfillment -> adapter.createOrder, e a
// "entrega" é o crédito no saldo do comprador + um recibo em texto.
// Código próprio (nunca mock-sandbox, que é excluído no modo REAL por
// selection.ts).
export const INTERNAL_BALANCE_CODE = "internal-balance";
const IDENTITY_PREFIX = "balance-topup:";

export class BalanceTopupError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BalanceTopupError";
  }
}

export function balanceTopupIdentity(orderId: string) {
  const normalized = orderId.trim();
  if (!normalized) throw new BalanceTopupError("BALANCE_TOPUP_ORDER_ID_REQUIRED");
  return `${IDENTITY_PREFIX}${normalized}`;
}

// O valor creditado vem SEMPRE do ProviderProduct (metadata.creditAmountCents),
// nunca do valor pago nem do preço por nível do comprador.
export function creditAmountFromMetadata(metadata: unknown) {
  const value =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).creditAmountCents
      : undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new BalanceTopupError("BALANCE_TOPUP_CREDIT_AMOUNT_INVALID");
  return value;
}

function receipt(orderId: string, creditedCents: number, balanceAfterCents: number): ProviderOrderResult {
  const identity = balanceTopupIdentity(orderId);
  return {
    externalOrderId: identity,
    reference: identity,
    status: "COMPLETED",
    delivery: {
      kind: "provider-delivery",
      deliveryType: "TEXT",
      title: "Saldo creditado",
      deliveryFields: [
        { key: "credited", label: "Valor creditado", value: formatBRL(creditedCents), sensitive: false },
        { key: "balance", label: "Saldo após a recarga", value: formatBRL(balanceAfterCents), sensitive: false },
      ],
      instructions: `Saldo de ${formatBRL(creditedCents)} creditado. Saldo atual: ${formatBRL(balanceAfterCents)}.`,
    },
  };
}

export class BalanceTopupAdapter implements ProviderAdapter {
  readonly code = INTERNAL_BALANCE_CODE;
  readonly supportsReconciliation = true;

  constructor(private readonly db: Pick<PrismaClient, "$transaction" | "accountLedgerEntry"> = prisma) {}

  async checkConnection(): Promise<ProviderHealth> {
    return { connected: true, message: "Provider interno de saldo (sem integração externa)" };
  }

  async listProducts(): Promise<ProviderCatalogItem[]> {
    return [];
  }

  async getBalance(): Promise<ProviderBalance> {
    throw new BalanceTopupError("BALANCE_TOPUP_PROVIDER_BALANCE_NOT_SUPPORTED");
  }

  async createOrder(input: ProviderOrderInput): Promise<ProviderOrderResult> {
    const orderId = input.payload.orderId;
    if (typeof orderId !== "string" || !orderId.trim())
      throw new BalanceTopupError("BALANCE_TOPUP_ORDER_ID_REQUIRED");

    const { entry } = await this.db.$transaction(async (tx) => {
      // Exceção deliberada ao padrão dos adapters: o payload do engine
      // (buildProviderExecutionPayload) não traz o comprador, então este
      // adapter lê o próprio Order para descobrir quem recebe o crédito e
      // qual ProviderProduct foi comprado.
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          customerId: true,
          customer: { select: { passwordHash: true } },
          items: {
            take: 1,
            select: {
              providerProduct: {
                select: { externalProductId: true, metadata: true, provider: { select: { code: true } } },
              },
            },
          },
        },
      });
      if (!order) throw new BalanceTopupError("BALANCE_TOPUP_ORDER_NOT_FOUND");
      // Defesa extra além do LOGIN_REQUIRED do checkout: nunca credita saldo
      // numa conta guest (convite pendente, sem login possível).
      if (order.customer.passwordHash === PENDING_INVITE_HASH)
        throw new BalanceTopupError("BALANCE_TOPUP_GUEST_NOT_ALLOWED");
      const purchased = order.items[0]?.providerProduct;
      if (
        !purchased ||
        purchased.provider.code !== INTERNAL_BALANCE_CODE ||
        purchased.externalProductId !== input.providerProductId
      )
        throw new BalanceTopupError("BALANCE_TOPUP_PROVIDER_PRODUCT_MISMATCH");
      return creditTopup(tx, {
        userId: order.customerId,
        orderId,
        amountCents: creditAmountFromMetadata(purchased.metadata),
        note: `Recarga via pedido ${orderId}`,
      });
    });
    return receipt(orderId, entry.amountCents, entry.balanceAfterCents);
  }

  // Só consulta: nunca credita. Se o lançamento não existir, a transação do
  // crédito nunca foi confirmada.
  async getOrderStatus(externalOrderId: string): Promise<ProviderOrderResult> {
    if (!externalOrderId.startsWith(IDENTITY_PREFIX))
      return { externalOrderId, status: "FAILED", error: "BALANCE_TOPUP_IDENTITY_INVALID" };
    const orderId = externalOrderId.slice(IDENTITY_PREFIX.length);
    const entry = await this.db.accountLedgerEntry.findUnique({ where: { sourceOrderId: orderId } });
    if (!entry)
      return { externalOrderId, reference: externalOrderId, status: "FAILED", error: "BALANCE_TOPUP_NOT_CREDITED" };
    return receipt(orderId, entry.amountCents, entry.balanceAfterCents);
  }

  buildReconciliationIdentity(orderId: string): string {
    return balanceTopupIdentity(orderId);
  }
}
