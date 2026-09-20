"use client";
import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";
export default function AdminImageUpload({
  kind,
  value,
  onChange,
  label = "Imagem",
}: {
  kind: "products" | "brands" | "banners";
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [unsavedUpload, setUnsavedUpload] = useState("");
  async function discardUnsaved(url: string) {
    const response = await fetch("/api/admin/assets", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) throw new Error("Falha ao remover imagem temporária.");
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    const response = await fetch("/api/admin/assets", {
      method: "POST",
      body: form,
    });
    const body = await response.json();
    if (!response.ok) {
      setBusy(false);
      return setError(body.error ?? "Falha no upload.");
    }
    if (unsavedUpload) {
      try {
        await discardUnsaved(unsavedUpload);
      } catch {
        setError("A imagem anterior não pôde ser removida.");
      }
    }
    setUnsavedUpload(body.data.url);
    onChange(body.data.url);
    setBusy(false);
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      if (value === unsavedUpload) {
        await discardUnsaved(value);
        setUnsavedUpload("");
      }
      onChange("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao remover imagem.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-image-field">
      <b>{label}</b>
      {value && (
        <div className="image-preview">
          <Image src={value} alt="Prévia" fill unoptimized />
        </div>
      )}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={upload}
      />
      <div className="image-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? "Enviando..." : value ? "Trocar imagem" : "Enviar imagem"}
        </button>
        {value && (
          <button
            type="button"
            className="danger-link"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remover imagem
          </button>
        )}
      </div>
      <small>
        JPG, PNG ou WEBP. Máximo de 500 KB. A remoção é concluída ao salvar.
      </small>
      {error && <p className="form-message form-error">{error}</p>}
    </div>
  );
}
