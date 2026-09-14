import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { setSession } from "@/lib/auth";
import {
  publicUserCreateData,
  registrationSchema,
} from "@/lib/registration";

const duplicateEmailResponse = () =>
  NextResponse.json(
    { error: "Já existe uma conta com este e-mail. Entre na sua conta." },
    { status: 409 },
  );

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revise os dados informados." },
      { status: 422 },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true },
  });
  if (existing) return duplicateEmailResponse();

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: publicUserCreateData(parsed.data, passwordHash),
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        customerTier: true,
      },
    });

    await setSession(user);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return duplicateEmailResponse();
    }
    throw error;
  }
}
