export type ProviderModeValue = "TEST" | "REAL";
export type ProviderProductCandidate = {
  id: string; productId: string | null; externalProductId: string; active: boolean; mode: ProviderModeValue;
  providerCostCents: number | null; provider: { id: string; code: string; active: boolean };
};

export const NON_PRODUCTION_PROVIDER_CODES = ["mock-sandbox"] as const;

export function isProductionProviderCode(code: string) {
  return !NON_PRODUCTION_PROVIDER_CODES.includes(code as (typeof NON_PRODUCTION_PROVIDER_CODES)[number]);
}

export type ProviderResolution<T> =
  | { status:"SELECTED"; providerProduct:T }
  | { status:"MISSING" | "AMBIGUOUS"; providerProduct:null };

export function resolveProviderProduct<T extends ProviderProductCandidate>(candidates:T[], mode:ProviderModeValue):ProviderResolution<T> {
  const eligible=candidates.filter(item=>item.mode===mode&&item.active&&item.provider.active&&(mode!=="REAL"||isProductionProviderCode(item.provider.code)));
  if(eligible.length===0)return{status:"MISSING",providerProduct:null};
  if(eligible.length>1)return{status:"AMBIGUOUS",providerProduct:null};
  return{status:"SELECTED",providerProduct:eligible[0]};
}

export function selectProviderProduct<T extends ProviderProductCandidate>(candidates:T[],mode:ProviderModeValue="TEST") {
  return resolveProviderProduct(candidates,mode).providerProduct;
}
