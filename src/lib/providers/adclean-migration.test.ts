import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260913223000_adclean_v2_provider/migration.sql",
  "utf8",
);

describe("preparação segura do provider AdClean", () => {
  it("cria o provider inativo e preserva o controle operacional existente", () => {
    expect(migration).toContain("'adclean'");
    expect(migration).toMatch(/'adclean',\s+false,/);
    expect(migration).not.toMatch(/ON CONFLICT[\s\S]*SET[\s\S]{0,300}"active"/);
    expect(migration).not.toMatch(/ON CONFLICT[\s\S]*SET[\s\S]{0,300}"integrationStatus"/);
  });

  it("vincula somente o produto DRAFT ao ticket CODE sem publicar ou mudar preço", () => {
    expect(migration).toContain("'ticket-168h'");
    expect(migration).toContain("'CODE'");
    expect(migration).toContain('AND "status" = \'DRAFT\'');
    expect(migration).not.toContain("'PUBLISHED'");
    expect(migration).not.toContain('"priceCents"');
    expect(migration).not.toContain('"normalPriceCents"');
    expect(migration).not.toContain('"premiumPriceCents"');
  });
});
