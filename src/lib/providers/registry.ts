import { MockProviderAdapter } from "./mock";
import type { ProviderAdapter } from "./types";
import { configuredHeartUnlocksAdapter } from "./heartunlocks";

export function resolveProviderAdapter(code: string): ProviderAdapter | null {
  if(code==="mock-sandbox")return new MockProviderAdapter();
  if(code==="heartunlocks")return configuredHeartUnlocksAdapter();
  return null;
}
