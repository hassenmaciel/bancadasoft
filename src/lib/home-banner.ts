import { z } from "zod";

export const MAX_ACTIVE_HOME_BANNERS = 4;
export const HOME_BANNER_ROTATION_MS = 5000;

type LinkResult = { ok: true; value: string | null } | { ok: false };

/**
 * Link do banner: caminho interno ("/catalogo/...") ou URL externa http(s).
 * Rejeita javascript:, data:, "//host" (protocol-relative) e afins.
 */
export function parseBannerLink(raw: string | null | undefined): LinkResult {
  const value = (raw ?? "").trim();
  if (!value) return { ok: true, value: null };
  if (value.startsWith("/")) {
    const unsafe = value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value);
    return unsafe ? { ok: false } : { ok: true, value };
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? { ok: true, value: url.toString() } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export const isExternalBannerLink = (link: string) => /^https?:\/\//i.test(link);

const bannerLink = z
  .string()
  .max(500)
  .nullable()
  .optional()
  .transform((value, ctx) => {
    const parsed = parseBannerLink(value);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: "Use um caminho interno (/catalogo) ou uma URL http(s)." });
      return z.NEVER;
    }
    return parsed.value;
  });

export const homeBannerInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().trim().url().max(1000).refine((v) => /^https:\/\//i.test(v), "A imagem deve usar https."),
  linkUrl: bannerLink,
  sortOrder: z.number().int().min(1).max(99),
  active: z.boolean(),
});
export type HomeBannerInput = z.infer<typeof homeBannerInputSchema>;

/** `otherActiveCount` exclui o próprio banner em edição. */
export const exceedsActiveLimit = (otherActiveCount: number, willBeActive: boolean) =>
  otherActiveCount + (willBeActive ? 1 : 0) > MAX_ACTIVE_HOME_BANNERS;

export type PublicHomeBanner = { id: string; title: string; imageUrl: string; linkUrl: string | null };

export async function publicHomeBanners(db: {
  homeBanner: { findMany: (args: object) => Promise<PublicHomeBanner[]> };
}): Promise<PublicHomeBanner[]> {
  return db.homeBanner.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: MAX_ACTIVE_HOME_BANNERS,
    select: { id: true, title: true, imageUrl: true, linkUrl: true },
  });
}
