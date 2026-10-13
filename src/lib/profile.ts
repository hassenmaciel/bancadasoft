import { prisma } from "./prisma";
import { ProfileUpdateInput } from "./profile-schema";

export async function updateUserProfile(userId: string, input: ProfileUpdateInput) {
    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            name: input.name,
            email: input.email,
            whatsapp: input.whatsapp,
        },
        select: {
            id: true,
            email: true,
            name: true,
            whatsapp: true,
            cpfCnpj: true,
            customerTier: true,
        },
    });

    return updated;
}

export async function getUserProfile(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            whatsapp: true,
            cpfCnpj: true,
            customerTier: true,
            role: true,
            createdAt: true,
        },
    });

    return user;
}