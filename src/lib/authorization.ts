export const isAdminRole = (role: string) => role === "ADMIN";
export const isResellerRole = (role: string) => role === "RESELLER";

export function assertAdminRole(role: string) {
  if (!isAdminRole(role)) throw new Error("FORBIDDEN");
}
