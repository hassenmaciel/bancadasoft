"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminProductDTO } from "@/lib/admin-catalog";

type CategoryOption = { id: string; name: string };
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function ProductForm({ product, categories }: { product?: AdminProductDTO; categories: CategoryOption[] }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [slug, setSlug] = useState(product?.slug ?? "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage(""); const form = new FormData(event.currentTarget);
    const price = Number(String(form.get("price") ?? "").replace(",", "."));
    const payload = { name: form.get("name"), slug, description: form.get("description"), type: form.get("type"), duration: form.get("duration") || null, priceCents: Math.round(price * 100), categoryId: form.get("categoryId"), imageUrl: form.get("imageUrl") || null, status: form.get("status"), available: form.get("available") === "on" };
    const response = await fetch(product ? `/api/admin/products/${product.id}` : "/api/admin/products", { method: product ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json(); setSaving(false);
    if (!response.ok) return setMessage(result.error ?? "Não foi possível salvar.");
    setMessage("Produto salvo com sucesso."); router.push("/admin/produtos"); router.refresh();
  }
  return <form className="admin-form" onSubmit={submit}>
    <div className="form-grid"><label>Nome<input name="name" defaultValue={product?.name} required onChange={(event) => { if (!product) setSlug(slugify(event.target.value)); }} /></label><label>Slug<input name="slug" value={slug} onChange={(event) => setSlug(slugify(event.target.value))} required /></label></div>
    <label>Descrição<textarea name="description" defaultValue={product?.description} required rows={4} /></label>
    <div className="form-grid"><label>Categoria<select name="categoryId" defaultValue={product?.category.id} required><option value="">Selecione</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Tipo<select name="type" defaultValue={product?.type ?? "TOOL"}>{["TOOL","RENTAL","LICENSE","REMOTE_SERVICE","CREDIT"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <div className="form-grid"><label>Preço (R$)<input name="price" type="number" min="0" step="0.01" defaultValue={product ? (product.priceCents / 100).toFixed(2) : "0.00"} required /></label><label>Duração<input name="duration" defaultValue={product?.duration ?? ""} placeholder="Ex.: 6 horas" /></label></div>
    <label>URL da imagem<input name="imageUrl" type="url" defaultValue={product?.imageUrl ?? ""} placeholder="https://..." /></label>
    <div className="form-grid"><label>Status<select name="status" defaultValue={product?.status ?? "DRAFT"}>{["DRAFT","REVIEWED","PUBLISHED","PAUSED","ARCHIVED"].map((item) => <option key={item}>{item}</option>)}</select></label><label className="check-field"><input name="available" type="checkbox" defaultChecked={product?.available ?? true} /> Disponível para venda</label></div>
    {message && <p className="form-message">{message}</p>}<div className="form-actions"><button type="button" onClick={() => router.back()}>Cancelar</button><button className="admin-primary" disabled={saving}>{saving ? "Salvando..." : "Salvar produto"}</button></div>
  </form>;
}
