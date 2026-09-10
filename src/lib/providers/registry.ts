import { MockProviderAdapter } from "./mock";
import type { ProviderAdapter } from "./types";

export function resolveProviderAdapter(code: string): ProviderAdapter | null {
  return code === "mock-sandbox" ? new MockProviderAdapter() : null;
}
