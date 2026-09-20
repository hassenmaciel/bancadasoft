"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import AdminImageUpload from "@/components/admin-image-upload";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
import { MAX_ACTIVE_HOME_BANNERS } from "@/lib/home-banner";

type Row = { id: string; title: string; imageUrl: string; linkUrl: string | null; sortOrder: number; active: boolean };

export default function BannerManager({ rows }: { rows: Row[] }) {
  const router = useRouter(),
    [editing, setEditing] = useState<Row | null>(null),
    [deleting, setDeleting] = useState<Row | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [image, setImage] = useState(""),
    activeCount = rows.filter((row) => row.active).length;

  function edit(row: Row) {
    setEditing(row);
    setImage(row.imageUrl);
    setMessage("");
  }

  async function save(id: string | undefined, payload: Omit<Row, "id">) {
    const response = await fetch(id ? `/api/admin/banners/${id}` : "/api/admin/banners", {
      method: id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setMessage(response.ok ? "Banner salvo com sucesso." : body.error);
    if (response.ok) router.refresh();
    return response.ok;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image) return setMessage("Envie a imagem do banner.");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const ok = await save(editing?.id, {
      title: String(form.get("title")),
      imageUrl: image,
      linkUrl: String(form.get("linkUrl") ?? "").trim() || null,
      sortOrder: Number(form.get("sortOrder")) || 1,
      active: form.get("active") === "on",
    });
    setBusy(false);
    if (ok) {
      setEditing(null);
      setImage("");
    }
  }

  async function toggle(row: Row) {
    setBusy(true);
    await save(row.id, { title: row.title, imageUrl: row.imageUrl, linkUrl: row.linkUrl, sortOrder: row.sortOrder, active: !row.active });
    setBusy(false);
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const response = await fetch(`/api/admin/banners/${deleting.id}`, { method: "DELETE" }),
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
          <h2>{editing ? "Editar banner" : "Novo banner"}</h2>
          <label>
            Título interno
            <input name="title" defaultValue={editing?.title} key={`t-${editing?.id}`} maxLength={120} required placeholder="Ex.: Promo UnlockTool Setembro" />
            <small>Usado só para identificar o banner aqui no Admin.</small>
          </label>
          <AdminImageUpload kind="banners" value={image} onChange={setImage} label="Arte do banner" />
          <small className="banner-hint">
            Proporção recomendada: <b>2,1 : 1</b> (horizontal), por exemplo <b>1100 × 525 px</b>. A área real no Hero tem cerca de 367 × 176 px em desktop; a arte é ajustada sem distorcer, com pequenos cortes nas bordas se a proporção for diferente. Não coloque textos importantes rente às bordas.
          </small>
          <label>
            Link (opcional)
            <input name="linkUrl" defaultValue={editing?.linkUrl ?? ""} key={`l-${editing?.id}`} maxLength={500} placeholder="/catalogo ou https://parceiro.com" />
            <small>Caminho interno abre na mesma aba; URL externa (http/https) abre em nova aba.</small>
          </label>
          <label>
            Ordem
            <input name="sortOrder" type="number" min={1} max={99} defaultValue={editing?.sortOrder ?? rows.length + 1} key={`o-${editing?.id}`} required />
          </label>
          <label className="check-field">
            <input name="active" type="checkbox" defaultChecked={editing?.active ?? activeCount < MAX_ACTIVE_HOME_BANNERS} key={`a-${editing?.id}`} /> Ativo (máx. {MAX_ACTIVE_HOME_BANNERS} ativos)
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
        <section className="category-list banner-list">
          {rows.length === 0 && <p className="form-message">Nenhum banner cadastrado. A Home exibe os três benefícios padrão.</p>}
          {rows.map((row) => (
            <article key={row.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="banner-thumb" src={row.imageUrl} alt={`Arte: ${row.title}`} />
              <div>
                <b>{row.title}</b>
                <small>
                  Ordem {row.sortOrder} · {row.active ? "Ativo" : "Inativo"} · {row.linkUrl ?? "sem link"}
                </small>
              </div>
              <div className="inline-actions">
                <button disabled={busy} onClick={() => edit(row)}>Editar</button>
                <button disabled={busy} onClick={() => void toggle(row)}>{row.active ? "Desativar" : "Ativar"}</button>
                <button disabled={busy} className="danger-link" onClick={() => setDeleting(row)}>Excluir</button>
              </div>
            </article>
          ))}
        </section>
      </div>
      <AdminConfirmDialog
        open={Boolean(deleting)}
        title={`Excluir ${deleting?.title}?`}
        description="O banner e a imagem enviada serão removidos definitivamente."
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </>
  );
}
