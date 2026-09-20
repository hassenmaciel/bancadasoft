const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
// Nomes são UUID (nunca reutilizados), então o arquivo é imutável.
export const UPLOAD_CACHE_CONTROL = "public, max-age=31536000";
export const MAX_ADMIN_IMAGE_BYTES = 500 * 1024;
export function validateAdminImage(input: { type: string; size: number }) {
  if (!allowedTypes.has(input.type))
    return { ok: false as const, error: "Use JPG, PNG ou WEBP." };
  if (input.size <= 0 || input.size > MAX_ADMIN_IMAGE_BYTES)
    return { ok: false as const, error: "A imagem deve ter no máximo 500 KB." };
  return { ok: true as const, extension: allowedTypes.get(input.type)! };
}
export function storageConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = env.SUPABASE_STORAGE_BUCKET?.trim() || "catalog-assets";
  if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !serviceKey)
    return null;
  return { url, serviceKey, bucket };
}
export const storageAuthHeaders = (key: string) => ({
  ...(key.startsWith("sb_secret_")
    ? {}
    : { authorization: `Bearer ${key}` }),
  apikey: key,
  "user-agent": "BancadaSoft-Admin-Storage/1.0",
});
export async function ensurePublicAssetBucket(
  config: NonNullable<ReturnType<typeof storageConfig>>,
  fetcher: typeof fetch = fetch,
) {
  const check = await fetcher(
    `${config.url}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`,
    { headers: storageAuthHeaders(config.serviceKey) },
  );
  if (check.ok) return;
  if (check.status !== 404) throw new Error("STORAGE_BUCKET_CHECK_FAILED");
  const created = await fetcher(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      ...storageAuthHeaders(config.serviceKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: config.bucket,
      name: config.bucket,
      public: true,
      file_size_limit: MAX_ADMIN_IMAGE_BYTES,
      allowed_mime_types: [...allowedTypes.keys()],
    }),
  });
  if (!created.ok && ![400, 409].includes(created.status))
    throw new Error("STORAGE_BUCKET_CREATE_FAILED");
}
export async function uploadAdminAsset(input: {
  file: File;
  kind: "products" | "brands" | "banners";
  fetcher?: typeof fetch;
}) {
  const valid = validateAdminImage(input.file);
  if (!valid.ok) throw new Error(valid.error);
  const config = storageConfig();
  if (!config) throw new Error("STORAGE_NOT_CONFIGURED");
  const fetcher = input.fetcher ?? fetch;
  await ensurePublicAssetBucket(config, fetcher);
  const path = `${input.kind}/${crypto.randomUUID()}.${valid.extension}`;
  const uploaded = await fetcher(
    `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${path}`,
    {
      method: "POST",
      headers: {
        ...storageAuthHeaders(config.serviceKey),
        "content-type": input.file.type,
        "x-upsert": "false",
        "cache-control": UPLOAD_CACHE_CONTROL,
      },
      body: await input.file.arrayBuffer(),
    },
  );
  if (!uploaded.ok) throw new Error("STORAGE_UPLOAD_FAILED");
  return {
    url: `${config.url}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/${path}`,
    path,
  };
}
export function ownedAssetPath(
  url: string,
  config: NonNullable<ReturnType<typeof storageConfig>>,
) {
  const prefix = `${config.url}/storage/v1/object/public/${encodeURIComponent(config.bucket)}/`;
  return url.startsWith(prefix)
    ? decodeURIComponent(url.slice(prefix.length))
    : null;
}
export async function removeAdminAsset(
  url: string,
  fetcher: typeof fetch = fetch,
) {
  const config = storageConfig();
  if (!config) throw new Error("STORAGE_NOT_CONFIGURED");
  const path = ownedAssetPath(url, config);
  if (!path || path.includes("..")) return false;
  const response = await fetcher(
    `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`,
    {
      method: "DELETE",
      headers: {
      ...storageAuthHeaders(config.serviceKey),
        "content-type": "application/json",
      },
      body: JSON.stringify({ prefixes: [path] }),
    },
  );
  if (!response.ok) throw new Error("STORAGE_DELETE_FAILED");
  return true;
}
