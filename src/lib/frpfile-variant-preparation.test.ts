import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "prisma/migrations/20260913162000_product_variants/migration.sql",
  "utf8",
);

const commercialIds = [
  "221", "3081", "3126", "3128", "223", "4400", "4401", "222", "224", "4493",
  "226", "228", "3175", "230", "3183", "3475", "3476", "3477", "3478", "3479",
  "3480", "3481", "3482", "3483", "3484", "225", "229", "227",
];

describe("FRPFILE draft variant preparation", () => {
  it("prepares exactly the 12 approved DRAFT cards", () => {
    expect(migration.match(/'DRAFT'::"ProductStatus"/g)).toHaveLength(1);
    expect(migration.match(/^\s*\('frpfile-[^']+', 'frpfile-[^']+', 'FRPFILE/gm)).toHaveLength(12);
  });

  it("prepares all 28 approved provider products without Refund 3127", () => {
    for (const id of commercialIds) expect(migration).toContain(`'${id}'`);
    expect(new Set(commercialIds).size).toBe(28);
    expect(migration).not.toMatch(/source\.externalId[^\n]*3127|\('.*', '3127',/);
  });

  it("keeps 3175 and 230 inactive and blocked with their operational reasons", () => {
    expect(migration).toContain("'3175', 'FMI OFF/Open Menu', 'fmi-off-open-menu', false");
    expect(migration).toContain("Origem/formato do Order code não confirmado.");
    expect(migration).toContain("'230', 'Open Menu MacBook', 'open-menu-macbook', false");
    expect(migration).toContain("Origem/formato do Code não confirmado.");
  });
});
