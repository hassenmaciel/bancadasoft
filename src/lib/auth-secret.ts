export class AuthConfigurationError extends Error {
  constructor(public readonly code:"AUTH_SECRET_MISSING"|"AUTH_SECRET_INVALID") { super(code); this.name="AuthConfigurationError"; }
}

export function getAuthSecret(value:string|undefined=process.env.AUTH_SECRET) {
  if (value === undefined) throw new AuthConfigurationError("AUTH_SECRET_MISSING");
  if (!value.trim() || new TextEncoder().encode(value).byteLength < 32) throw new AuthConfigurationError("AUTH_SECRET_INVALID");
  return new TextEncoder().encode(value);
}
