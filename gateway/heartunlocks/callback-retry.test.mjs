import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALLBACK_RETRY_DELAYS_MS, MAX_PENDING_CALLBACKS, createCallbackRetrier } from "./callback-retry.mjs";

const notice = (referenceId, status = "SUCCESS") => ({ reference_id: referenceId, order_id: "order-1", status, replay: "segredo-do-cliente" });
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const minutes = (n) => n * 60_000;

describe("HeartUnlocks callback retry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses 1, 2, 4 and 8 minute delays and a 500 pending limit", () => {
    expect(CALLBACK_RETRY_DELAYS_MS).toEqual([minutes(1), minutes(2), minutes(4), minutes(8)]);
    expect(MAX_PENDING_CALLBACKS).toBe(500);
  });

  it("delivers on the first attempt without queuing", async () => {
    const forward = vi.fn().mockResolvedValue(undefined);
    const logger = makeLogger();
    const retrier = createCallbackRetrier({ forward, logger });
    await expect(retrier.deliver(notice("ref-1"))).resolves.toEqual({ delivered: true });
    expect(retrier.pendingCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(minutes(20));
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("queues on failure and delivers on the second attempt after 1 minute", async () => {
    const forward = vi.fn().mockRejectedValueOnce(new Error("APP_CALLBACK_HTTP_503")).mockResolvedValue(undefined);
    const logger = makeLogger();
    const retrier = createCallbackRetrier({ forward, logger });
    await expect(retrier.deliver(notice("ref-2"))).resolves.toEqual({ delivered: false, queued: true });
    expect(logger.warn).toHaveBeenCalledWith("callback forward attempt", { referenceId: "ref-2", attempt: 1, maxAttempts: 5, result: "APP_CALLBACK_HTTP_503" });

    await vi.advanceTimersByTimeAsync(minutes(1) - 1);
    expect(forward).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(forward).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("callback retry attempt", { referenceId: "ref-2", attempt: 2, maxAttempts: 5, result: "ok" });
    expect(retrier.pendingCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(minutes(20));
    expect(forward).toHaveBeenCalledTimes(2);
  });

  it("gives up after 5 attempts and logs the exhaustion without sensitive values", async () => {
    const forward = vi.fn().mockRejectedValue(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
    const logger = makeLogger();
    const retrier = createCallbackRetrier({ forward, logger });
    await retrier.deliver(notice("ref-3"));

    await vi.advanceTimersByTimeAsync(minutes(1));
    expect(forward).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(minutes(2));
    expect(forward).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(minutes(4));
    expect(forward).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(minutes(8));
    expect(forward).toHaveBeenCalledTimes(5);

    expect(logger.info).toHaveBeenLastCalledWith("callback retry attempt", { referenceId: "ref-3", attempt: 5, maxAttempts: 5, result: "TypeError:ECONNREFUSED" });
    expect(logger.error).toHaveBeenCalledWith("callback retry exhausted", { referenceId: "ref-3", attempts: 5, result: "TypeError:ECONNREFUSED" });
    expect(retrier.pendingCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(minutes(60));
    expect(forward).toHaveBeenCalledTimes(5);

    const logged = JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(logged).not.toContain("segredo-do-cliente");
  });

  it("does not resend a duplicate reference_id while a retry is pending, and retries the latest notice", async () => {
    const forward = vi.fn().mockRejectedValueOnce(new Error("APP_CALLBACK_HTTP_500")).mockResolvedValue(undefined);
    const logger = makeLogger();
    const retrier = createCallbackRetrier({ forward, logger });
    await retrier.deliver(notice("ref-4", "PROCESSING"));
    await expect(retrier.deliver(notice("ref-4", "SUCCESS"))).resolves.toEqual({ delivered: false, queued: true, duplicate: true });
    expect(forward).toHaveBeenCalledTimes(1);
    expect(retrier.pendingCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(minutes(1));
    expect(forward).toHaveBeenCalledTimes(2);
    expect(forward).toHaveBeenLastCalledWith(notice("ref-4", "SUCCESS"));
    await vi.advanceTimersByTimeAsync(minutes(20));
    expect(forward).toHaveBeenCalledTimes(2);
  });

  it("drops new failures above the 500 pending limit and logs a critical error", async () => {
    const forward = vi.fn().mockRejectedValue(new Error("APP_CALLBACK_HTTP_502"));
    const logger = makeLogger();
    const retrier = createCallbackRetrier({ forward, logger });
    for (let i = 0; i < MAX_PENDING_CALLBACKS; i += 1) await retrier.deliver(notice(`ref-${i}`));
    expect(retrier.pendingCount()).toBe(500);
    expect(logger.error).not.toHaveBeenCalled();

    await expect(retrier.deliver(notice("ref-overflow"))).resolves.toEqual({ delivered: false, queued: false });
    expect(retrier.pendingCount()).toBe(500);
    expect(logger.error).toHaveBeenCalledWith("CRITICAL callback retry queue full, notice dropped", { referenceId: "ref-overflow", pending: 500, limit: 500 });
  });
});
