import { MockProviderAdapter } from "./mock";
import type { ProviderAdapter } from "./types";
import { configuredHeartUnlocksAdapter } from "./heartunlocks";
import { configuredAdcleanAdapter } from "./adclean";
import { BalanceTopupAdapter, INTERNAL_BALANCE_CODE } from "./internal-balance";

export function resolveProviderAdapter(code: string): ProviderAdapter | null {
  if(code==="mock-sandbox")return new MockProviderAdapter();
  if(code==="heartunlocks")return configuredHeartUnlocksAdapter();
  if(code==="adclean")return configuredAdcleanAdapter();
  if(code===INTERNAL_BALANCE_CODE)return new BalanceTopupAdapter();
  return null;
}
