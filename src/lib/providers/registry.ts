import { MockProviderAdapter } from "./mock";
import type { ProviderAdapter } from "./types";
import { configuredHeartUnlocksAdapter } from "./heartunlocks";
import { configuredAdcleanAdapter } from "./adclean";

export function resolveProviderAdapter(code: string): ProviderAdapter | null {
  if(code==="mock-sandbox")return new MockProviderAdapter();
  if(code==="heartunlocks")return configuredHeartUnlocksAdapter();
  if(code==="adclean")return configuredAdcleanAdapter();
  return null;
}
