// Pacote de Recarga de Saldo pronto para o checkout no modo REAL: o preço da
// recarga vem sempre de metadata.creditAmountCents (ver assertCheckoutPrice).
export const topupProviderProduct = (creditAmountCents: number, extra: Record<string, unknown> = {}) => ({
  id: `pp-topup-${creditAmountCents}`,
  externalProductId: `topup-${creditAmountCents}`,
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  fieldSchema: [],
  metadata: { creditAmountCents } as unknown,
  provider: { id: "prov-internal-balance", active: true, code: "internal-balance" },
  ...extra,
});
