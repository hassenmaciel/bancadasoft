import { describe, expect, it } from "vitest";
import { publicViewer } from "./public-viewer";

describe("publicViewer", () => {
  it("exposes only name and role", () => {
    const viewer = publicViewer({ id: "u1", email: "a@b.c", name: "Ana Souza", role: "ADMIN", customerTier: "PREMIUM" } as never);
    expect(viewer).toEqual({ name: "Ana Souza", role: "ADMIN" });
  });
  it("returns null for anonymous visitors", () => {
    expect(publicViewer(null)).toBeNull();
    expect(publicViewer(undefined)).toBeNull();
  });
});
