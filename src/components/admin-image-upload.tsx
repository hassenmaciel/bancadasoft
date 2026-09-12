"use client";
import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";
export default function AdminImageUpload({
  kind,
  value,
  onChange,
  label = "Imagem",
}: {
  kind: "products" | "brands";
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    setBusy(false);
    if (!response.ok) return setError(body.error ?? "Falha no upload.");
    onChange(body.data.url);
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
            onClick={() => onChange("")}
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
