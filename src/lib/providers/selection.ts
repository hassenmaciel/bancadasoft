export type ProviderModeValue = "TEST" | "REAL";
export type ProviderProductCandidate = {
  id: string; productId: string | null; externalProductId: string; active: boolean; mode: ProviderModeValue;
  providerCostCents: number | null; provider: { id: string; active: boolean };
};

export type ProviderResolution<T> =
  | { status:"SELECTED"; providerProduct:T }
  | { status:"MISSING" | "AMBIGUOUS"; providerProduct:null };

export function resolveProviderProduct<T extends ProviderProductCandidate>(candidates:T[], mode:ProviderModeValue):ProviderResolution<T> {
  const eligible=candidates.filter(item=>item.mode===mode&&item.active&&item.provider.active);
  if(eligible.length===0)return{status:"MISSING",providerProduct:null};
  if(eligible.length>1)return{status:"AMBIGUOUS",providerProduct:null};
  return{status:"SELECTED",providerProduct:eligible[0]};
}

export function selectProviderProduct<T extends ProviderProductCandidate>(candidates:T[],mode:ProviderModeValue="TEST") {
  return resolveProviderProduct(candidates,mode).providerProduct;
}
