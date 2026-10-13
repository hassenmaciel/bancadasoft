import { NextResponse } from "next/server";
import { session } from "@/lib/auth";
import { profileSchema } from "@/lib/profile-schema";
import { updateUserProfile, getUserProfile } from "@/lib/profile";

export async function GET() {
    const viewer = await session();
    if (!viewer?.id) {
        return NextResponse.json(
            { ok: false, error: "Autenticação necessária.", code: "NOT_AUTHENTICATED" },
            { status: 401 }
        );
    }

    const profile = await getUserProfile(viewer.id);
    if (!profile) {
        return NextResponse.json(
            { ok: false, error: "Perfil não encontrado.", code: "PROFILE_NOT_FOUND" },
            { status: 404 }
        );
    }

    return NextResponse.json({ ok: true, data: profile });
}

export async function PUT(request: Request) {
    const viewer = await session();
    if (!viewer?.id) {
        return NextResponse.json(
            { ok: false, error: "Autenticação necessária.", code: "NOT_AUTHENTICATED" },
            { status: 401 }
        );
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { ok: false, error: "Dados de perfil inválidos.", code: "INVALID_PROFILE" },
            { status: 400 }
        );
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { ok: false, error: "Revise os dados informados e tente novamente.", code: "INVALID_PROFILE_DATA" },
            { status: 400 }
        );
    }

    try {
        const updated = await updateUserProfile(viewer.id, parsed.data);
        return NextResponse.json({ ok: true, data: updated });
    } catch (error) {
        if (error instanceof Error && error.message.includes("Unique constraint failed")) {
            return NextResponse.json(
                { ok: false, error: "Este email já está cadastrado.", code: "EMAIL_ALREADY_EXISTS" },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { ok: false, error: "Erro ao atualizar perfil.", code: "PROFILE_UPDATE_ERROR" },
            { status: 500 }
        );
    }
}