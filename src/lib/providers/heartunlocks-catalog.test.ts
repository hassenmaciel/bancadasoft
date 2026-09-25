import { describe, expect, it } from "vitest";
import { parseHeartUnlocksCatalogResponse, providerCatalogSyncData } from "./heartunlocks-catalog";

const realObservedItem = {
  name: "UNLOCKTOOL RENT [6 Hours]",
  type: "remote",
  cid: "C443",
  cids: ["C443", "C3", "C455"],
  price: "0.28",
  time: "1-60 Minutes",
  fields: [{ type: "quantity", name: "Quantity", base: true, required: true }],
  image_url: "https://static.dhrufusion.net/product.jpeg",
};

describe("HeartUnlocks catalog contract", () => {
  it("maps the observed reseller product without inventing commercial data", () => {
    const [item] = parseHeartUnlocksCatalogResponse({ status: "success", code: 200, data: { currency: "USD", categories: { C443: { name: "Remote Services" } }, products: { "2194": realObservedItem } } });
    expect(item).toMatchObject({ externalProductId: "2194", label: realObservedItem.name, costCents: 28, currency: "USD", type: "remote", providerTime: "1-60 Minutes" });
    expect(item.requiredFields).toEqual([{ type: "quantity", name: "Quantity", base: true, required: true }]);
    expect(item.metadata).toMatchObject({ categoryId: "C443", categoryName: "Remote Services", categoryIds: ["C443", "C3", "C455"], providerImageUrl: realObservedItem.image_url });
  });

  it("keeps the raw field name with surrounding spaces and still skips blank names", () => {
    const [item] = parseHeartUnlocksCatalogResponse({ status: "success", data: { products: { "3126": {
      name: "FRPFILE Activator",
      price: "1.00",
      fields: [{ type: "text", name: " Serial ", required: true }, { type: "text", name: "   " }],
    } } } });
    expect(item.requiredFields).toEqual([{ type: "text", name: " Serial ", required: true, base: null }]);
    const update = providerCatalogSyncData(item, new Date("2026-09-25T12:00:00Z"));
    expect(update.fieldSchema).toMatchObject([{ key: "serial", label: "Serial", providerFieldName: " Serial " }]);
  });

  it("rejects an invalid response before persistence", () => {
    expect(() => parseHeartUnlocksCatalogResponse({ status: "error", data: [] })).toThrow("HEARTUNLOCKS_INVALID_CATALOG_RESPONSE");
    expect(() => parseHeartUnlocksCatalogResponse({ status: "success", data: { currency: "USD", products: { "2194": {} } } })).toThrow("HEARTUNLOCKS_INVALID_CATALOG_ITEM_0");
  });

  it("does not overwrite an existing cost or currency when the provider omits them", () => {
    const [item] = parseHeartUnlocksCatalogResponse({ status: "success", data: { products: { "1": { name: "No price" } } } });
    const update = providerCatalogSyncData(item, new Date("2026-09-11T12:00:00Z"));
    expect(update).not.toHaveProperty("providerCostCents");
    expect(update).not.toHaveProperty("currency");
    expect(update).toMatchObject({ label: "No price", syncStatus: "SYNCED" });
  });
});
