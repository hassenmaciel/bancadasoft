"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import AdminImageUpload from "@/components/admin-image-upload";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
type Row = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  active: boolean;
  _count: { products: number };
};
const slugify = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export default function BrandManager({ rows }: { rows: Row[] }) {
  const router = useRouter(),
    [editing, setEditing] = useState<Row | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [image, setImage] = useState("");
  function edit(row: Row) {
    setEditing(row);
    setImage(row.imageUrl ?? "");
    setMessage("");
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget),
      payload = {
        name: String(f.get("name")),
        slug: slugify(String(f.get("slug") || f.get("name"))),
        imageUrl: image || null,
        active: f.get("active") === "on",
      };
    const response = await fetch(
        editing ? `/api/admin/brands/${editing.id}` : "/api/admin/brands",
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
      result = await response.json();
    setBusy(false);
    setMessage(response.ok ? "Marca salva com sucesso." : result.error);
    if (response.ok) {
      setEditing(null);
      setImage("");
      router.refresh();
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await fetch(`/api/admin/brands/${deleting.id}`, {
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
      <div className="category-layout">
        <form className="admin-form compact" onSubmit={submit}>
          <h2>{editing ? "Editar marca" : "Nova marca"}</h2>
          <label>
            Nome
            <input
              name="name"
              defaultValue={editing?.name}
              key={`n-${editing?.id}`}
              required
            />
          </label>
          <label>
            Slug
            <input
              name="slug"
              defaultValue={editing?.slug}
              key={`s-${editing?.id}`}
            />
          </label>
          <AdminImageUpload
            kind="brands"
            value={image}
            onChange={setImage}
            label="Logo da marca"
          />
          <label className="check-field">
            <input
              name="active"
              type="checkbox"
              defaultChecked={editing?.active ?? true}
              key={`a-${editing?.id}`}
            />{" "}
            Ativa
          </label>
          {message && <p className="form-message">{message}</p>}
          <div className="form-actions">
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setImage("");
                }}
              >
                Cancelar
              </button>
            )}
            <button className="admin-primary" disabled={busy}>
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
        <section className="category-list">
          {rows.map((row) => (
            <article key={row.id}>
              <div>
                <b>{row.name}</b>
                <small>
                  {row.slug} · {row._count.products} produtos ·{" "}
                  {row.active ? "Ativa" : "Inativa"}
                </small>
              </div>
              <div className="inline-actions">
                <button onClick={() => edit(row)}>Editar</button>
                <button
                  className="danger-link"
                  onClick={() => setDeleting(row)}
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
        description="Se houver produtos associados, a marca será apenas desativada para preservar a integridade."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
