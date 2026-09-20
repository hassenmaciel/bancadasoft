import type { UserSessionDTO } from "@/lib/dto";

// Apenas o necessário para o cabeçalho público; nunca envia id/e-mail ao client.
export type PublicViewer = { name: string; role: UserSessionDTO["role"] } | null;

export function publicViewer(user: Pick<UserSessionDTO, "name" | "role"> | null | undefined): PublicViewer {
  return user ? { name: user.name, role: user.role } : null;
}
