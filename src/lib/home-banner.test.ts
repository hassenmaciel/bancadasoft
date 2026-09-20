import { describe, expect, it, vi } from "vitest";
import { exceedsActiveLimit, homeBannerInputSchema, isExternalBannerLink, MAX_ACTIVE_HOME_BANNERS, parseBannerLink, publicHomeBanners } from "./home-banner";

const valid = { title: "Promo", imageUrl: "https://x.supabase.co/storage/v1/object/public/catalog-assets/banners/a.webp", linkUrl: null, sortOrder: 1, active: true };

describe("parseBannerLink", () => {
  it("aceita vazio, interno e externo http(s)", () => {
    expect(parseBannerLink("")).toEqual({ ok: true, value: null });
    expect(parseBannerLink(undefined)).toEqual({ ok: true, value: null });
    expect(parseBannerLink("/catalogo?ordem=populares")).toEqual({ ok: true, value: "/catalogo?ordem=populares" });
    expect(parseBannerLink("https://parceiro.com/promo")).toEqual({ ok: true, value: "https://parceiro.com/promo" });
    expect(parseBannerLink("http://parceiro.com")).toMatchObject({ ok: true });
  });
  it.each(["javascript:alert(1)", "JaVaScript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.com", "/\\evil.com", "ftp://x.com", "nao-e-url", "/a\nb"])("rejeita %s", (link) => {
    expect(parseBannerLink(link)).toEqual({ ok: false });
  });
  it("distingue externo de interno", () => {
    expect(isExternalBannerLink("https://a.com")).toBe(true);
    expect(isExternalBannerLink("/catalogo")).toBe(false);
  });
});

describe("homeBannerInputSchema", () => {
  it("aceita banner válido sem link", () => {
    expect(homeBannerInputSchema.safeParse(valid).success).toBe(true);
  });
  it("normaliza link vazio para null", () => {
    const parsed = homeBannerInputSchema.parse({ ...valid, linkUrl: "  " });
    expect(parsed.linkUrl).toBeNull();
  });
  it("exige imagem https, título e link seguro", () => {
    expect(homeBannerInputSchema.safeParse({ ...valid, imageUrl: "" }).success).toBe(false);
    expect(homeBannerInputSchema.safeParse({ ...valid, imageUrl: "http://x.com/a.png" }).success).toBe(false);
    expect(homeBannerInputSchema.safeParse({ ...valid, title: " " }).success).toBe(false);
    expect(homeBannerInputSchema.safeParse({ ...valid, linkUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(homeBannerInputSchema.safeParse({ ...valid, sortOrder: 0 }).success).toBe(false);
  });
});

describe("limite de banners ativos", () => {
  it("permite até 4 ativos e bloqueia o 5º", () => {
    expect(exceedsActiveLimit(3, true)).toBe(false);
    expect(exceedsActiveLimit(4, true)).toBe(true);
    expect(exceedsActiveLimit(4, false)).toBe(false);
    expect(MAX_ACTIVE_HOME_BANNERS).toBe(4);
  });
});

describe("publicHomeBanners", () => {
  it("consulta só ativos, por ordem, máximo 4 e sem campos administrativos", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await publicHomeBanners({ homeBanner: { findMany } });
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 4,
      select: { id: true, title: true, imageUrl: true, linkUrl: true },
    });
  });
});
