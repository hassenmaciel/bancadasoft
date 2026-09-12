"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
type Row = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  productCount: number;
};
const slugify = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export default function CategoryManager({
  initialCategories,
}: {
  initialCategories: Row[];
}) {
  const router = useRouter(),
    [editing, setEditing] = useState<Row | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget),
      name = String(form.get("name"));
    const response = await fetch(
        editing
          ? `/api/admin/categories/${editing.id}`
          : "/api/admin/categories",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            slug: slugify(String(form.get("slug") || name)),
            active: form.get("active") === "on",
          }),
        },
      ),
      result = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Categoria salva com sucesso." : result.error);
    if (response.ok) {
      setEditing(null);
      router.refresh();
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await fetch(`/api/admin/categories/${deleting.id}`, {
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
      <header className="admin-heading">
        <div>
          <small>CATÁLOGO</small>
          <h1>Categorias</h1>
          <p>Organize os produtos exibidos na loja.</p>
        </div>
      </header>
      <div className="category-layout">
        <form className="admin-form compact" onSubmit={submit}>
          <h2>{editing ? "Editar categoria" : "Nova categoria"}</h2>
          <label>
            Nome
            <input
              name="name"
              defaultValue={editing?.name}
              key={`name-${editing?.id}`}
              required
            />
          </label>
          <label>
            Slug
            <input
              name="slug"
              defaultValue={editing?.slug}
              key={`slug-${editing?.id}`}
            />
          </label>
          <label className="check-field">
            <input
              name="active"
              type="checkbox"
              defaultChecked={editing?.active ?? true}
              key={`active-${editing?.id}`}
            />{" "}
            Ativa
          </label>
          {message && <p className="form-message">{message}</p>}
          <div className="form-actions">
            {editing && (
              <button type="button" onClick={() => setEditing(null)}>
                Cancelar
              </button>
            )}
            <button className="admin-primary" disabled={busy}>
              Salvar
            </button>
          </div>
        </form>
        <section className="category-list">
          {initialCategories.map((item) => (
            <article key={item.id}>
              <div>
                <b>{item.name}</b>
                <small>
                  {item.slug} · {item.productCount} produtos ·{" "}
                  {item.active ? "Ativa" : "Inativa"}
                </small>
              </div>
              <div className="inline-actions">
                <button onClick={() => setEditing(item)}>Editar</button>
                <button
                  className="danger-link"
                  onClick={() => setDeleting(item)}
                >
                  Excluir
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
      <AdminConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${deleting?.name}?`}
        description="Se houver produtos associados, a categoria será apenas desativada."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
