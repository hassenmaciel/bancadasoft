import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { setSession } from "@/lib/auth";
import {
  handleRegistrationRequest,
  type RegisteredSessionUser,
} from "@/lib/registration-route";

const sessionSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  customerTier: true,
} as const;

const isDuplicateKeyError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return handleRegistrationRequest(body, {
    findExisting: (email) =>
      prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true, cpfCnpj: true },
      }),
    hashPassword,
    async createUser(data) {
      try {
        return await prisma.user.create({ data, select: sessionSelect });
      } catch (error) {
        if (isDuplicateKeyError(error)) return null;
        throw error;
      }
    },
    async activateUser(userId, data): Promise<RegisteredSessionUser | null> {
      // updateMany + condição PENDING_INVITE torna a ativação atômica contra
      // uma segunda tentativa concorrente do mesmo convite (evita corrida).
      const claim = await prisma.user.updateMany({
        where: { id: userId, passwordHash: "PENDING_INVITE" },
        data,
      });
      if (claim.count !== 1) return null;
      return prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: sessionSelect,
      });
    },
    setSession,
  });
}
