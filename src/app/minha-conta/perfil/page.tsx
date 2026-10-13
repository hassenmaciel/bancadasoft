import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PublicHeader from "@/components/public-header";
import PublicFooter from "@/components/public-footer";
import CustomerProfileForm from "@/components/customer-profile-form";
import { publicViewer } from "@/lib/public-viewer";
import { requireUser } from "@/lib/auth";
import { getUserProfile } from "@/lib/profile";

export const metadata: Metadata = {
    title: "Editar perfil | BancadaSoft",
    robots: { index: false, follow: false },
};

export default async function ProfilePage() {
    let user;
    try {
        user = await requireUser();
    } catch {
        redirect("/login?next=/minha-conta/perfil");
    }

    const profile = await getUserProfile(user.id);

    return (
        <main>
            <PublicHeader viewer={publicViewer(user)} />
            <section className="customer-page wrap">
                <nav className="breadcrumbs">
                    <Link href="/">Início</Link>
                    <span>›</span>
                    <b>Editar perfil</b>
                </nav>
                <header>
                    <span className="eyebrow dark">Sua conta</span>
                    <h1>Editar perfil</h1>
                    <p>Atualize seus dados pessoais.</p>
                </header>
                <CustomerProfileForm initialData={profile} />
            </section>
            <PublicFooter />
        </main>
    );
}