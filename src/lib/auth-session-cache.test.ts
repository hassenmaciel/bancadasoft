import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn());
const cookieGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findFirst, findUnique: vi.fn() } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet, set: vi.fn(), delete: vi.fn() }) }));

import { session } from "./auth";

describe("session", () => {
  beforeEach(() => { findFirst.mockReset(); cookieGet.mockReset(); });

  it("returns null without a cookie and without touching the database", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(session()).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("returns null for an invalid token (authorization logic unchanged)", async () => {
    cookieGet.mockReturnValue({ value: "not-a-jwt" });
    await expect(session()).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
