"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
import ResellerKeysDialog, { type ResellerKeyRow } from "./reseller-keys-dialog";
type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  customerTier: "NORMAL" | "PREMIUM" | "PREMIUM_PLUS";
  canUseBalanceAsPayment: boolean;
  // Recarga bloqueada pelo Admin: o cliente não recarrega e uma recarga não promove.
  balanceTopupBlocked: boolean;
  active: boolean;
  createdAt: string;
  // Só o indicador: número e CPF ficam fora do HTML da lista (ver /contact).
  hasWhatsapp: boolean;
  orderCount: number;
  // null = linha de AccountBalance ainda não criada (equivale a saldo 0, desabilitado).
  balance: { enabled: boolean; balanceCents: number } | null;
  resellerKeys: ResellerKeyRow[];
};
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const date = (iso: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
type Contact = {
  whatsappLink: string | null;
  cpfCnpj: string | null;
  createdAt: string;
  orderCount: number;
  lastOrderAt: string | null;
  balance: { enabled: boolean; balanceCents: number } | null;
};
// Cada chamada grava USER_CONTACT_VIEWED na auditoria.
async function fetchContact(userId: string): Promise<Contact> {
  const response = await fetch(`/api/admin/users/${userId}/contact`, { method: "POST" }),
    body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os dados do cadastro.");
  return body.data;
}
function RegistrationDetails({ userId }: { userId: string }) {
  const [state, setState] = useState<{ contact?: Contact; error?: string }>({});
  useEffect(() => {
    let alive = true;
    fetchContact(userId).then(
      (contact) => alive && setState({ contact }),
      (error: Error) => alive && setState({ error: error.message }),
    );
    return () => {
      alive = false;
    };
  }, [userId]);
  const { contact, error } = state;
  return (
    <section>
      <h2>Dados do cadastro</h2>
      {error ? (
        <p className="form-message form-error">{error}</p>
      ) : !contact ? (
        <p className="security-note">Carregando…</p>
      ) : (
        <dl>
          <dt>WhatsApp</dt>
          <dd>
            {contact.whatsappLink ? (
              <a href={contact.whatsappLink} target="_blank" rel="noopener noreferrer">
                Abrir WhatsApp
              </a>
            ) : (
              <button type="button" disabled>
                Sem WhatsApp
              </button>
            )}
          </dd>
          <dt>CPF</dt>
          <dd>{contact.cpfCnpj ?? "Não informado"}</dd>
          <dt>Cadastro</dt>
          <dd>{date(contact.createdAt)}</dd>
          <dt>Pedidos</dt>
          <dd>{contact.orderCount}</dd>
          <dt>Último pedido</dt>
          <dd>{contact.lastOrderAt ? date(contact.lastOrderAt) : "Nenhum"}</dd>
          <dt>Saldo</dt>
          <dd>
            {contact.balance
              ? `${money(contact.balance.balanceCents)}${contact.balance.enabled ? "" : " (desabilitado)"}`
              : "Sem saldo"}
          </dd>
        </dl>
      )}
    </section>
  );
}
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
    [deleting, setDeleting] = useState<Row | null>(null),
    [purging, setPurging] = useState<Row | null>(null),
    [purgeConfirm, setPurgeConfirm] = useState(""),
    [keysTarget, setKeysTarget] = useState<Row | null>(null),
    [demoting, setDemoting] = useState<{ row: Row; patch: Record<string, string> } | null>(null),
    [blockTopupOnDemote, setBlockTopupOnDemote] = useState(true);
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
          canUseBalanceAsPayment: f.get("canUseBalanceAsPayment") === "on",
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
    setMessage(
      response.ok
        ? body.balanceEnabled
          ? "Usuário atualizado. Saldo e uso de saldo como pagamento habilitados (Premium Plus)."
          : "Usuário atualizado."
        : body.error,
    );
    if (response.ok) {
      setEditing(null);
      setStatusTarget(null);
      router.refresh();
    }
  }
  // Rebaixar um PREMIUM_PLUS (tabela ou edição) passa pelo diálogo que oferece
  // bloquear a recarga na mesma requisição — sem isso, a próxima recarga paga
  // promove de volta. Os demais saves seguem direto.
  function requestSave(row: Row, patch: Record<string, string>) {
    const demotes =
      row.customerTier === "PREMIUM_PLUS" && patch.customerTier !== undefined && patch.customerTier !== "PREMIUM_PLUS";
    if (demotes && !row.balanceTopupBlocked) {
      setBlockTopupOnDemote(true);
      setDemoting({ row, patch });
      return;
    }
    void save(row, patch);
  }
  async function toggleBalance(row: Row, enabled: boolean) {
    setBusy(true);
    const response = await fetch(`/api/admin/users/${row.id}/balance`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled }),
    }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? (enabled ? "Saldo habilitado." : "Saldo desabilitado.") : body.error);
    if (response.ok) router.refresh();
  }
  async function resetPassword(row: Row, form: HTMLFormElement) {
    setBusy(true);
    const response = await fetch(`/api/admin/users/${row.id}/password`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: new FormData(form).get("newPassword") }),
    }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? body.data.message : body.error);
    if (response.ok) {
      form.reset();
      setEditing(null);
      if (row.id === currentAdminId) router.push("/login");
    }
  }
  async function openWhatsapp(row: Row) {
    // A aba abre no próprio clique (depois do await o navegador bloquearia o
    // pop-up) e só navega quando a rota devolve o link; opener zerado = noopener.
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const { whatsappLink } = await fetchContact(row.id);
      if (whatsappLink && tab) return tab.location.replace(whatsappLink);
      tab?.close();
      setMessage(whatsappLink ? "O navegador bloqueou a nova aba do WhatsApp." : "WhatsApp do cadastro ausente ou inválido.");
    } catch (error) {
      tab?.close();
      setMessage((error as Error).message);
    }
  }
  async function purge(confirmEmail: string) {
    if (!purging) return;
    setBusy(true);
    const response = await fetch(`/api/admin/users/${purging.id}/permanent`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmEmail }),
    }),
      body = await response.json();
    setBusy(false);
    setMessage(response.ok ? body.data.message : body.error);
    if (response.ok) {
      setPurging(null);
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
              <option value="RESELLER">RESELLER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
          <label>
            Nível comercial
            <select name="customerTier" defaultValue="NORMAL">
              <option value="NORMAL">Técnico Normal</option>
              <option value="PREMIUM">Técnico Premium</option>
              <option value="PREMIUM_PLUS">Técnico Premium Plus</option>
            </select>
          </label>
          <label>
            <input type="checkbox" name="canUseBalanceAsPayment" />
            Permitir usar saldo como pagamento
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
                <th>Saldo</th>
                <th>Uso de saldo</th>
                <th>Recarga</th>
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
                    <div className="inline-actions">
                      <button type="button" disabled={!row.hasWhatsapp} onClick={() => void openWhatsapp(row)}>
                        {row.hasWhatsapp ? "WhatsApp" : "Sem WhatsApp"}
                      </button>
                    </div>
                  </td>
                  <td>
                    <select
                      value={row.role === "CUSTOMER" ? "USER" : row.role}
                      disabled={busy}
                      onChange={(e) => save(row, { role: e.target.value })}
                    >
                      <option>USER</option>
                      <option>RESELLER</option>
                      <option>ADMIN</option>
                    </select>
                  </td>
                  <td>
                    <select value={row.customerTier} disabled={busy} onChange={(e) => requestSave(row, { customerTier: e.target.value })}>
                      <option value="NORMAL">NORMAL</option>
                      <option value="PREMIUM">PREMIUM</option>
                      <option value="PREMIUM_PLUS">PREMIUM_PLUS</option>
                    </select>
                  </td>
                  <td>{row.active ? "Ativo" : "Inativo"}</td>
                  <td>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={Boolean(row.balance?.enabled)}
                        disabled={busy}
                        onChange={(e) => toggleBalance(row, e.target.checked)}
                      />
                      Saldo habilitado
                    </label>
                    {row.balance && <small className="cell-subtitle">{money(row.balance.balanceCents)}</small>}
                  </td>
                  <td>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={row.canUseBalanceAsPayment}
                        disabled={busy || row.customerTier === "PREMIUM_PLUS"}
                        onChange={(e) => save(row, { canUseBalanceAsPayment: e.target.checked })}
                      />
                      Usar saldo
                    </label>
                    {row.customerTier === "PREMIUM_PLUS" && <small className="cell-subtitle">Sempre ativo</small>}
                  </td>
                  <td>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={row.balanceTopupBlocked}
                        disabled={busy}
                        onChange={(e) => save(row, { balanceTopupBlocked: e.target.checked })}
                      />
                      Bloquear recarga
                    </label>
                  </td>
                  <td>{row.orderCount}</td>
                  <td>
                    <div className="inline-actions">
                      <button onClick={() => setEditing(row)}>Editar</button>
                      {row.role === "RESELLER" && (
                        <button onClick={() => setKeysTarget(row)}>Chaves de API</button>
                      )}
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
                      <button
                        disabled={row.id === currentAdminId}
                        className="danger-link"
                        onClick={() => {
                          setPurgeConfirm("");
                          setPurging(row);
                        }}
                      >
                        Excluir permanentemente
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
          <div className="admin-confirm admin-form" role="dialog" aria-label={`Editar ${editing.name}`}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const shownRole = editing.role === "CUSTOMER" ? "USER" : editing.role;
                const next = {
                  name: String(data.get("name") ?? "").trim(),
                  email: String(data.get("email") ?? "").trim().toLowerCase(),
                  role: String(data.get("role")),
                  customerTier: String(data.get("customerTier")),
                };
                // Só envia o que mudou (CUSTOMER aparece como USER e não é "mudança").
                const patch: Record<string, string> = {};
                if (next.name !== editing.name) patch.name = next.name;
                if (next.email !== editing.email.toLowerCase()) patch.email = next.email;
                if (next.role !== shownRole) patch.role = next.role;
                if (next.customerTier !== editing.customerTier) patch.customerTier = next.customerTier;
                if (Object.keys(patch).length === 0) return setEditing(null);
                requestSave(editing, patch);
              }}
            >
              <h2>Editar usuário</h2>
              <label>
                Nome
                <input name="name" defaultValue={editing.name} required minLength={2} maxLength={100} />
              </label>
              <label>
                E-mail
                <input name="email" type="email" defaultValue={editing.email} required />
              </label>
              <label>
                Role
                <select name="role" defaultValue={editing.role === "CUSTOMER" ? "USER" : editing.role}>
                  <option value="USER">USER</option>
                  <option value="RESELLER">RESELLER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </label>
              <label>
                Nível comercial
                <select name="customerTier" defaultValue={editing.customerTier}>
                  <option value="NORMAL">Técnico Normal</option>
                  <option value="PREMIUM">Técnico Premium</option>
                  <option value="PREMIUM_PLUS">Técnico Premium Plus</option>
                </select>
              </label>
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button className="admin-primary" disabled={busy}>
                  Salvar
                </button>
              </div>
            </form>
            <RegistrationDetails key={editing.id} userId={editing.id} />
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void resetPassword(editing, event.currentTarget);
              }}
            >
              <h2>Redefinir senha</h2>
              <label>
                Nova senha
                <input name="newPassword" type="password" minLength={12} maxLength={128} autoComplete="new-password" required />
                <small>12+ caracteres, com maiúscula, minúscula, número e símbolo.</small>
              </label>
              <p className="security-note">
                Encerra todas as sessões abertas do usuário. Combine a entrega da nova senha por um canal seguro.
              </p>
              <button className="admin-primary" disabled={busy}>
                Redefinir senha
              </button>
            </form>
          </div>
        </div>
      )}
      {purging && (
        <div className="admin-confirm-backdrop" role="presentation">
          <form
            className="admin-confirm admin-form"
            role="alertdialog"
            aria-label={`Excluir ${purging.name} permanentemente`}
            onSubmit={(event) => {
              event.preventDefault();
              void purge(purgeConfirm);
            }}
          >
            <h2>Excluir {purging.name} permanentemente?</h2>
            <p className="security-note">
              <b>Esta ação é irreversível.</b> Serão apagados o usuário e todos os pedidos, pagamentos, eventos,
              entregas, saldo, lançamentos de saldo e chaves de API vinculados a ele ({purging.orderCount} pedido(s)
              {purging.balance ? `, saldo de ${money(purging.balance.balanceCents)}` : ""}). Fica registrado só um resumo
              na auditoria.
            </p>
            <label>
              Para confirmar, digite o e-mail do usuário: <b>{purging.email}</b>
              <input
                value={purgeConfirm}
                onChange={(event) => setPurgeConfirm(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setPurging(null)}>
                Cancelar
              </button>
              <button
                className="admin-danger"
                disabled={busy || purgeConfirm.trim().toLowerCase() !== purging.email.toLowerCase()}
              >
                {busy ? "Excluindo..." : "Excluir permanentemente"}
              </button>
            </div>
          </form>
        </div>
      )}
      {demoting && (
        <div className="admin-confirm-backdrop" role="presentation">
          <section className="admin-confirm admin-form" role="alertdialog" aria-modal="true" aria-labelledby="demote-title">
            <h2 id="demote-title">Rebaixar {demoting.row.name} de Premium Plus?</h2>
            <p>
              O saldo restante e o uso de saldo como pagamento continuam. Sem bloqueio, a próxima recarga paga promove o
              cliente de volta a Premium Plus.
            </p>
            <label className="check-field">
              <input
                type="checkbox"
                checked={blockTopupOnDemote}
                onChange={(event) => setBlockTopupOnDemote(event.target.checked)}
              />
              Bloquear também a recarga deste cliente
            </label>
            <div className="form-actions">
              <button type="button" disabled={busy} onClick={() => setDemoting(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="admin-primary"
                disabled={busy}
                onClick={() => {
                  const { row, patch } = demoting;
                  setDemoting(null);
                  void save(row, blockTopupOnDemote ? { ...patch, balanceTopupBlocked: true } : patch);
                }}
              >
                {busy ? "Processando..." : "Rebaixar"}
              </button>
            </div>
          </section>
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
      {keysTarget && (
        <ResellerKeysDialog
          userId={keysTarget.id}
          userName={keysTarget.name}
          keys={rows.find((row) => row.id === keysTarget.id)?.resellerKeys ?? []}
          onClose={() => setKeysTarget(null)}
        />
      )}
      <AdminConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${deleting?.name}?`}
        description="Usuários com pedidos serão desativados; o histórico comercial é preservado. Para apagar tudo, use “Excluir permanentemente”."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}