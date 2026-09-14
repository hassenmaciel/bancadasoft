"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  customerTier: "NORMAL" | "PREMIUM";
  active: boolean;
  createdAt: string;
  orderCount: number;
};
export default function UserManager({
  rows,
  currentAdminId,
}: {
  rows: Row[];
  currentAdminId: string;
}) {
  const router = useRouter(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    [statusTarget, setStatusTarget] = useState<Row | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget),
      response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.get("name"),
          email: f.get("email"),
          password: f.get("password"),
          role: f.get("role"),
          customerTier: f.get("customerTier"),
        }),
      }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Usuário criado com sucesso." : body.error);
    if (response.ok) {
      e.currentTarget.reset();
      router.refresh();
    }
  }
  async function save(row: Row, patch: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch(`/api/admin/users/${row.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Usuário atualizado." : body.error);
    if (response.ok) {
      setEditing(null);
      setStatusTarget(null);
      router.refresh();
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await fetch(`/api/admin/users/${deleting.id}`, {
        method: "DELETE",
      }),
      body = await response.json();
    setBusy(false);
    setDeleting(null);
    setMessage(response.ok ? body.data.message : body.error);
    if (response.ok) router.refresh();
  }
  return (
    <>
      {message && <p className="form-message">{message}</p>}
      <div className="user-admin-grid">
        <form className="admin-form compact" onSubmit={create}>
          <h2>Adicionar usuário</h2>
          <label>
            Nome
            <input name="name" required />
          </label>
          <label>
            E-mail
            <input name="email" type="email" required />
          </label>
          <label>
            Senha inicial escolhida com segurança
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
            <small>
              12+ caracteres, com maiúscula, minúscula, número e símbolo.
            </small>
          </label>
          <label>
            Role
            <select name="role" defaultValue="USER">
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label>
            Nível comercial
            <select name="customerTier" defaultValue="NORMAL">
              <option value="NORMAL">Técnico Normal</option>
              <option value="PREMIUM">Técnico Premium</option>
            </select>
          </label>
          <button className="admin-primary" disabled={busy}>
            Criar usuário
          </button>
        </form>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Role</th>
                <th>Nível comercial</th>
                <th>Status</th>
                <th>Pedidos</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <small className="cell-subtitle">{row.email}</small>
                  </td>
                  <td>
                    <select
                      value={row.role === "CUSTOMER" ? "USER" : row.role}
                      disabled={busy}
                      onChange={(e) => save(row, { role: e.target.value })}
                    >
                      <option>USER</option>
                      <option>ADMIN</option>
                    </select>
                  </td>
                  <td><select value={row.customerTier} disabled={busy} onChange={(e) => save(row, { customerTier: e.target.value })}><option value="NORMAL">NORMAL</option><option value="PREMIUM">PREMIUM</option></select></td>
                  <td>{row.active ? "Ativo" : "Inativo"}</td>
                  <td>{row.orderCount}</td>
                  <td>
                    <div className="inline-actions">
                      <button onClick={() => setEditing(row)}>Editar</button>
                      <button
                        disabled={row.id === currentAdminId}
                        onClick={() => setStatusTarget(row)}
                      >
                        {row.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        disabled={row.id === currentAdminId}
                        className="danger-link"
                        onClick={() => setDeleting(row)}
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <div className="admin-confirm-backdrop" role="presentation">
          <form
            className="admin-confirm admin-form"
            aria-label={`Editar ${editing.name}`}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void save(editing, { name: data.get("name") });
            }}
          >
            <h2>Editar usuário</h2>
            <label>
              Nome
              <input name="name" defaultValue={editing.name} required />
            </label>
            <p className="security-note">
              O e-mail e a senha não são alterados por esta operação.
            </p>
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="admin-primary" disabled={busy}>
                Salvar
              </button>
            </div>
          </form>
        </div>
      )}
      {statusTarget && (
        <AdminConfirmDialog
          open
          title={`${statusTarget.active ? "Desativar" : "Ativar"} ${statusTarget.name}?`}
          description={
            statusTarget.active
              ? "O usuário perderá acesso, mas o histórico será preservado."
              : "O acesso será restaurado."
          }
          busy={busy}
          onCancel={() => setStatusTarget(null)}
          onConfirm={() => save(statusTarget, { active: !statusTarget.active })}
        />
      )}
      <AdminConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${deleting?.name}?`}
        description="Usuários com pedidos serão desativados; o histórico comercial nunca será apagado."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
