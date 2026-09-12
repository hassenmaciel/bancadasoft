import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("product card media", () => {
  it("fills the card media area without internal padding or distortion", () => {
    const css = readFileSync(new URL("../app/catalog.css", import.meta.url), "utf8");
    const imageRule = css.match(/\.product-art img\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(imageRule).toMatch(/object-fit:\s*cover/);
    expect(imageRule).toMatch(/object-position:\s*center/);
    expect(imageRule).toMatch(/padding:\s*0/);
    expect(imageRule).not.toMatch(/object-fit:\s*contain/);
  });
});
