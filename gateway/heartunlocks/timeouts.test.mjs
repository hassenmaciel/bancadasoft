import { describe, expect, it } from "vitest";
import { APP_WAIT_MARGIN_MS, PROVIDER_DEADLINE_MS } from "./timeouts.mjs";
import { HEARTUNLOCKS_GATEWAY_TIMEOUT_MS } from "../../src/lib/providers/heartunlocks";

describe("HeartUnlocks app↔gateway timeout invariant", () => {
  it("the app always waits longer than the gateway's total deadline, with margin", () => {
    expect(PROVIDER_DEADLINE_MS).toBe(15000);
    expect(HEARTUNLOCKS_GATEWAY_TIMEOUT_MS).toBeGreaterThanOrEqual(PROVIDER_DEADLINE_MS + APP_WAIT_MARGIN_MS);
  });
});
