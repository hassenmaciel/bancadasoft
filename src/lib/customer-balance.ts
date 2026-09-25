import { AccountLedgerEntryType, ProductType } from "@prisma/client";
import { formatBRL } from "@/lib/account-balance";
import type { PriceViewer } from "@/lib/commercial-pricing";
import { productDto } from "@/lib/dto";
import { prisma } from "@/lib/prisma";

// Painel de saldo do cliente (/minha-conta/saldo). Só leitura: saldo, extrato
// e os pacotes de recarga. A recarga em si reaproveita a página do produto e o
// checkout existentes (link com ?variante=), sem lógica de pagamento aqui.

export const LEDGER_PAGE_SIZE = 20;

export const ledgerTypeLabel: Record<AccountLedgerEntryType, string> = {
  TOPUP: "Recarga",
  PURCHASE: "Compra",
  REFUND: "Estorno",
  ADJUSTMENT: "Ajuste",
};

export function signedBRL(cents: number) {
  return cents > 0 ? `+${formatBRL(cents)}` : cents < 0 ? `-${formatBRL(-cents)}` : formatBRL(0);
}

export function topupHref(slug: string, variantId?: string) {
  const base = `/produto/${encodeURIComponent(slug)}`;
  return variantId ? `${base}?variante=${encodeURIComponent(variantId)}` : base;
}

export type CustomerLedgerRow = {
  id: string;
  createdAt: Date;
  type: AccountLedgerEntryType;
  amountCents: number;
  balanceAfterCents: number;
};
export type TopupOption = { key: string; label: string; priceCents: number; href: string };
export type CustomerBalanceView = {
  enabled: boolean;
  balanceCents: number | null;
  entries: CustomerLedgerRow[];
  topupOptions: TopupOption[];
};

// Mesmo filtro de publicação da página /produto/[slug]; productDto aplica as
// regras de variante (ativa, publicada, provider REAL e pronto) e o preço do
// tier do cliente, então só aparecem pacotes que o checkout aceitaria.
async function loadTopupOptions(viewer: PriceViewer): Promise<TopupOption[]> {
  const product = await prisma.product.findFirst({
    where: { type: ProductType.BALANCE_TOPUP, status: "PUBLISHED", available: true, category: { active: true } },
    include: {
      category: true,
      brand: true,
      providerProducts: { where: { active: true, mode: "REAL" }, include: { provider: true } },
      variants: { include: { providerProduct: { include: { provider: true } } }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!product) return [];
  const dto = productDto(product, viewer);
  if (!dto.priceVisible) return [];
  if (dto.variants.length)
    return dto.variants.flatMap((variant) =>
      variant.priceCents === null
        ? []
        : [{ key: variant.id, label: variant.name, priceCents: variant.priceCents, href: topupHref(dto.slug, variant.id) }],
    );
  return dto.priceCents === null
    ? []
    : [{ key: dto.id, label: dto.name, priceCents: dto.priceCents, href: topupHref(dto.slug) }];
}

export async function loadCustomerBalance(
  user: { id: string; customerTier: NonNullable<PriceViewer>["customerTier"] },
): Promise<CustomerBalanceView> {
  const [balance, entries] = await Promise.all([
    prisma.accountBalance.findUnique({ where: { userId: user.id }, select: { balanceCents: true, enabled: true } }),
    prisma.accountLedgerEntry.findMany({
      where: { userId: user.id },
      select: { id: true, createdAt: true, type: true, amountCents: true, balanceAfterCents: true },
      orderBy: { createdAt: "desc" },
      take: LEDGER_PAGE_SIZE,
    }),
  ]);
  const enabled = balance?.enabled === true;
  // Recarga só é oferecida com saldo habilitado: o checkout recusa
  // BALANCE_TOPUP com BALANCE_NOT_ENABLED nos demais casos.
  const topupOptions = enabled ? await loadTopupOptions(user) : [];
  return { enabled, balanceCents: enabled ? balance!.balanceCents : null, entries, topupOptions };
}
