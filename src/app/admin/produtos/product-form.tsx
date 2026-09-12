"use client";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminProductDTO } from "@/lib/admin-catalog";
import { commercialMetrics } from "@/lib/admin-rules";
import AdminImageUpload from "@/components/admin-image-upload";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
type Option = { id: string; name: string };
const slugify = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const productTypes = [
  ["TOOL", "Ferramenta"],
  ["RENTAL", "Aluguel"],
  ["ACTIVATION", "Ativação"],
  ["LICENSE", "Licença"],
  ["CREDIT", "Crédito"],
  ["IMEI_SN", "IMEI / SN"],
  ["FILE", "Arquivo"],
  ["REMOTE_SERVICE", "Serviço remoto"],
];
const deliveryTypes = [
  ["IMMEDIATE", "Imediata"],
  ["AUTOMATIC", "Automática"],
  ["MANUAL", "Manual"],
  ["ON_REQUEST", "Sob consulta"],
];
export default function ProductForm({
  product,
  categories,
  brands,
}: {
  product?: AdminProductDTO;
  categories: Option[];
  brands: Option[];
}) {
  const router = useRouter(),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [confirming, setConfirming] = useState(false),
    [slug, setSlug] = useState(product?.slug ?? ""),
    [price, setPrice] = useState(product ? product.priceCents / 100 : 0),
    [cost, setCost] = useState(
      product?.costCents == null ? "" : String(product.costCents / 100),
    ),
    [image, setImage] = useState(product?.imageUrl ?? "");
  const metrics = useMemo(
    () => cost === "" ? null : commercialMetrics(Math.round(price * 100), Math.round(Number(cost) * 100)),
    [price, cost],
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    const payload = {
      name: f.get("name"),
      slug,
      description: f.get("description"),
      longDescription: f.get("longDescription") || null,
      type: f.get("type"),
      deliveryType: f.get("deliveryType"),
      deliveryEstimate: f.get("deliveryEstimate") || null,
      searchTerms: f.get("searchTerms") || "",
      duration: f.get("duration") || null,
      priceCents: Math.round(price * 100),
      costCents: cost === "" ? null : Math.round(Number(cost) * 100),
      categoryId: f.get("categoryId"),
      brandId: f.get("brandId") || null,
      imageUrl: image || null,
      status: f.get("status"),
      available: f.get("available") === "on",
      featured: f.get("featured") === "on",
      sortOrder: Number(f.get("sortOrder")),
    };
    const response = await fetch(
      product ? `/api/admin/products/${product.id}` : "/api/admin/products",
      {
        method: product ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = await response.json();
    setSaving(false);
    if (!response.ok)
      return setMessage(result.error ?? "Não foi possível salvar.");
    router.push("/admin/produtos");
    router.refresh();
  }
  async function remove() {
    if (!product) return;
    setSaving(true);
    const response = await fetch(`/api/admin/products/${product.id}`, {
        method: "DELETE",
      }),
      body = await response.json();
    setSaving(false);
    setConfirming(false);
    if (!response.ok)
      return setMessage(body.error ?? "Não foi possível excluir.");
    router.push(
      `/admin/produtos?message=${encodeURIComponent(body.data.message)}`,
    );
    router.refresh();
  }
  return (
    <>
      <form className="admin-form product-admin-form" onSubmit={submit}>
        <fieldset>
          <legend>Informações comerciais</legend>
          <div className="form-grid">
            <label>
              Nome
              <input
                name="name"
                defaultValue={product?.name}
                required
                onChange={(e) => {
                  if (!product) setSlug(slugify(e.target.value));
                }}
              />
            </label>
            <label>
              Slug
              <input
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                required
              />
            </label>
          </div>
          <label>
            Descrição curta
            <textarea
              name="description"
              defaultValue={product?.description}
              required
              rows={3}
            />
          </label>
          <label>
            Descrição completa
            <textarea
              name="longDescription"
              defaultValue={product?.longDescription ?? ""}
              rows={5}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Classificação e descoberta</legend>
          <div className="form-grid">
            <label>
              Categoria
              <select
                name="categoryId"
                defaultValue={product?.category.id}
                required
              >
                <option value="">Selecione</option>
                {categories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Marca
              <select name="brandId" defaultValue={product?.brand?.id ?? ""}>
                <option value="">Sem marca</option>
                {brands.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Tipo comercial
              <select name="type" defaultValue={product?.type ?? "TOOL"}>
                {productTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Modalidade / duração
              <input name="duration" defaultValue={product?.duration ?? ""} />
            </label>
          </div>
          <label>
            Palavras-chave
            <input
              name="searchTerms"
              defaultValue={product?.searchTerms ?? ""}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Entrega</legend>
          <div className="form-grid">
            <label>
              Tipo
              <select
                name="deliveryType"
                defaultValue={product?.deliveryType ?? "AUTOMATIC"}
              >
                {deliveryTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prazo comercial
              <input
                name="deliveryEstimate"
                defaultValue={product?.deliveryEstimate ?? ""}
              />
            </label>
          </div>
        </fieldset>
        {product?.providerProducts.length ? (
          <fieldset>
            <legend>Dados do fornecedor · somente leitura</legend>
            {product.providerProducts.map((link) => (
              <div className="provider-data" key={link.id}>
                <b>Sincronizado do fornecedor</b>
                <dl>
                  <div>
                    <dt>Provider</dt>
                    <dd>{link.provider.name}</dd>
                  </div>
                  <div>
                    <dt>Product ID</dt>
                    <dd>{link.externalProductId}</dd>
                  </div>
                  <div>
                    <dt>Custo original</dt>
                    <dd>
                      {link.providerCostCents === null
                        ? "Não informado"
                        : new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: link.currency,
                          }).format(link.providerCostCents / 100)}
                    </dd>
                  </div>
                  <div>
                    <dt>Moeda</dt>
                    <dd>{link.currency}</dd>
                  </div>
                  <div>
                    <dt>Status da sincronização</dt>
                    <dd>{link.syncStatus ?? "Não sincronizado"}</dd>
                  </div>
                  <div>
                    <dt>Última sincronização</dt>
                    <dd>{link.lastSyncedAt ? new Date(link.lastSyncedAt).toLocaleString("pt-BR") : "Não sincronizado"}</dd>
                  </div>
                  <div><dt>Operação</dt><dd>{link.active && link.provider.active ? "Ativa" : "Inativa"}</dd></div>
                  <div><dt>Prazo do fornecedor</dt><dd>{typeof link.metadata === "object" && link.metadata && "providerTime" in link.metadata ? String((link.metadata as {providerTime?:unknown}).providerTime ?? "Não informado") : "Não informado"}</dd></div>
                  <div><dt>Tipo do fornecedor</dt><dd>{typeof link.metadata === "object" && link.metadata && "providerType" in link.metadata ? String((link.metadata as {providerType?:unknown}).providerType ?? "Não informado") : "Não informado"}</dd></div>
                  <div><dt>Status do fornecedor</dt><dd>{typeof link.metadata === "object" && link.metadata && "providerStatus" in link.metadata ? String((link.metadata as {providerStatus?:unknown}).providerStatus ?? "Não informado pelo fornecedor") : "Não informado pelo fornecedor"}</dd></div>
                </dl>
              </div>
            ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend>Definido pela BancadaSoft</legend>
          <div className="form-grid">
            <label>
              Preço final (R$)
              <input
                type="number"
                min="0"
                step=".01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </label>
            <label>
              Custo interno opcional (R$)
              <input
                type="number"
                min="0"
                step=".01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
          </div>
          <div className="commercial-summary">
            {metrics ? <>
            <span>
              Lucro interno{" "}
              <b>
                {(metrics.profitCents / 100).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </b>
            </span>
            <span>
              Margem <b>{metrics.marginPercent.toFixed(2)}%</b>
            </span>
            </> : <span>Margem não calculada sem custo BRL. Custos em moeda estrangeira permanecem separados.</span>}
          </div>
          <div className="form-grid">
            <label>
              Status
              <select name="status" defaultValue={product?.status ?? "DRAFT"}>
                {["DRAFT", "REVIEWED", "PUBLISHED", "PAUSED", "ARCHIVED"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Prioridade
              <input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={product?.sortOrder ?? 0}
              />
            </label>
          </div>
          <div className="form-grid">
            <label className="check-field">
              <input
                name="available"
                type="checkbox"
                defaultChecked={product?.available ?? true}
              />{" "}
              Disponível para venda
            </label>
            <label className="check-field">
              <input
                name="featured"
                type="checkbox"
                defaultChecked={product?.featured ?? false}
              />{" "}
              Destaque editorial
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Imagem</legend>
          <AdminImageUpload
            kind="products"
            value={image}
            onChange={setImage}
            label="Imagem do produto"
          />
        </fieldset>
        {message && <p className="form-message">{message}</p>}
        <div className="form-actions">
          {product && (
            <button
              className="admin-danger-outline"
              type="button"
              onClick={() => setConfirming(true)}
            >
              Excluir ou arquivar
            </button>
          )}
          <button type="button" onClick={() => router.back()}>
            Cancelar
          </button>
          <button className="admin-primary" disabled={saving}>
            {saving ? "Salvando..." : "Salvar produto"}
          </button>
        </div>
      </form>
      <AdminConfirmDialog
        open={confirming}
        title={`Excluir ${product?.name}?`}
        description="Se houver histórico ou vínculo de fornecedor, o produto será arquivado e retirado da venda."
        busy={saving}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </>
  );
}
