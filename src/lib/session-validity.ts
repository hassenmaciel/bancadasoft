// O JWT guarda iat em segundos. Uma sessão emitida antes da última troca de
// senha (User.passwordChangedAt) deixa de valer; null = nunca trocou.
export function isSessionCurrent(issuedAtSeconds: number | undefined, passwordChangedAt: Date | null) {
  if (!passwordChangedAt) return true;
  if (typeof issuedAtSeconds !== "number") return false;
  return issuedAtSeconds >= Math.floor(passwordChangedAt.getTime() / 1000);
}
