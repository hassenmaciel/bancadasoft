export const isAdminRole = (role: string) => role === "ADMIN";

export function assertAdminRole(role: string) {
  if (!isAdminRole(role)) throw new Error("FORBIDDEN");
}
