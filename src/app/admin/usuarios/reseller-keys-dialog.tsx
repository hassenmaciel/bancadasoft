"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export type ResellerKeyRow = {
  id: string;
  label: string | null;
  active: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

const date = (value: string | null) => (value ? new Date(value).toLocaleString("pt-BR") : "—");

export default function ResellerKeysDialog({
  userId,
  userName,
  keys,
  onClose,
}: {
  userId: string;
  userName: string;
  keys: ResellerKeyRow[];
  onClose: () => void;
}) {
  const router = useRouter(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [issued, setIssued] = useState<string | null>(null);

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget,
      label = new FormData(form).get("label"),
      response = await fetch(`/api/admin/users/${userId}/reseller-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label || undefined }),
      }),
      body = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(body.error);
    setIssued(body.data.key);
    setMessage("");
    form.reset();
    router.refresh();
  }

  async function revoke(keyId: string) {
    setBusy(true);
    const response = await fetch(`/api/admin/users/${userId}/reseller-keys/${keyId}/revoke`, { method: "POST" }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Chave revogada." : body.error);
    if (response.ok) router.refresh();
  }

  return (
    <div className="admin-confirm-backdrop" role="presentation">
      <div className="admin-confirm admin-form" role="dialog" aria-label={`Chaves de API de ${userName}`}>
        <h2>Chaves de API — {userName}</h2>
        {issued && (
          <div className="security-note">
            <b>Copie a chave agora. Ela não será exibida de novo.</b>
            <input readOnly value={issued} onFocus={(event) => event.currentTarget.select()} />
          </div>
        )}
        {message && <p className="form-message">{message}</p>}
        <form onSubmit={issue}>
          <label>
            Identificação (opcional)
            <input name="label" maxLength={80} placeholder="Ex.: sistema da loja" />
          </label>
          <button className="admin-primary" disabled={busy}>Gerar nova chave</button>
        </form>
        <table className="admin-table">
          <thead>
            <tr><th>Identificação</th><th>Criada</th><th>Último uso</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {keys.length === 0 && <tr><td colSpan={5}>Nenhuma chave emitida.</td></tr>}
            {keys.map((key) => (
              <tr key={key.id}>
                <td>{key.label ?? "—"}</td>
                <td>{date(key.createdAt)}</td>
                <td>{date(key.lastUsedAt)}</td>
                <td>{key.revokedAt ? `Revogada em ${date(key.revokedAt)}` : key.active ? "Ativa" : "Inativa"}</td>
                <td>
                  {!key.revokedAt && (
                    <button className="danger-link" disabled={busy} onClick={() => revoke(key.id)}>Revogar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
