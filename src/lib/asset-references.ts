type Counter = { count: (args: { where: { imageUrl: string } }) => Promise<number> };

/** Category não tem campo de imagem; Product, Brand e HomeBanner têm. */
export async function isAssetReferenced(
  url: string,
  db: { product: Counter; brand: Counter; homeBanner: Counter },
) {
  const where = { imageUrl: url };
  const counts = await Promise.all([
    db.product.count({ where }),
    db.brand.count({ where }),
    db.homeBanner.count({ where }),
  ]);
  return counts.some((n) => n > 0);
}
