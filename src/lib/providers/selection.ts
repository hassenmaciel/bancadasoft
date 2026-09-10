export type ProviderProductCandidate = {
  id: string; productId: string; externalProductId: string; active: boolean; providerCostCents: number | null;
  provider: { id: string; active: boolean };
};

export function selectProviderProduct<T extends ProviderProductCandidate>(candidates: T[]): T | null {
  return candidates.filter((item) => item.active && item.provider.active).sort((left, right) =>
    (left.providerCostCents ?? Number.MAX_SAFE_INTEGER) - (right.providerCostCents ?? Number.MAX_SAFE_INTEGER))[0] ?? null;
}
