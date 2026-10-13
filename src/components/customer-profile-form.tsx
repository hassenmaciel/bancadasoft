"use client";

import { FormEvent, useState } from "react";

interface ProfileFormProps {
    initialData: {
        name: string;
        email: string;
        whatsapp: string | null;
        cpfCnpj: string | null;
    } | null;
}

export default function CustomerProfileForm({ initialData }: ProfileFormProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [formData, setFormData] = useState({
        name: initialData?.name || "",
        email: initialData?.email || "",
        whatsapp: initialData?.whatsapp || "",
    });

    async function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const response = await fetch("/api/customer/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            });

            const result = await response.json();

            if (!response.ok) {
                setError(result.error || "Erro ao atualizar perfil.");
                return;
            }

            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch {
            setError("Erro de conexão. Tente novamente.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="profile-form">
            <div className="form-group">
                <label htmlFor="name">Nome completo</label>
                <input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    disabled={loading}
                />
            </div>

            <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    disabled={loading}
                />
            </div>

            <div className="form-group">
                <label htmlFor="whatsapp">WhatsApp</label>
                <input
                    id="whatsapp"
                    type="tel"
                    value={formData.whatsapp}
                    onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                    placeholder="11999999999"
                    disabled={loading}
                />
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message">Perfil atualizado com sucesso!</div>}

            <button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar alterações"}
            </button>
        </form>
    );
}