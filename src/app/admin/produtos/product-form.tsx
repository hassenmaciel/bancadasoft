"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminProductDTO } from "@/lib/admin-catalog";
import { optionalCentsToInput, optionalInputToCents } from "@/lib/admin-price-input";
import AdminImageUpload from "@/components/admin-image-upload";
import AdminConfirmDialog from "@/components/admin-confirm-dialog";
import VariantManager from "./variant-manager";
type Option = { id: string; name: string };
const brl = (cents: number | null | undefined) => cents == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
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
  ["BALANCE_TOPUP", "Recarga de saldo"],
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
  providerOptions = [],
}: {
  product?: AdminProductDTO;
  categories: Option[];
  brands: Option[];
  providerOptions?: Array<{ id: string; label: string }>;
}) {
  const router = useRouter(),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [confirming, setConfirming] = useState(false),
    [slug, setSlug] = useState(product?.slug ?? ""),
    [pricingMode, setPricingMode] = useState(product?.pricingMode ?? "MANUAL"),
    [price, setPrice] = useState(product ? (product.manualPriceCents ?? product.priceCents) / 100 : 0),
    [publicPrice, setPublicPrice] = useState(product ? product.priceCents / 100 : 0),
    [normalPrice, setNormalPrice] = useState(product ? (product.normalPriceCents ?? product.priceCents) / 100 : 0),
    [premiumPrice, setPremiumPrice] = useState(product?.premiumPriceCents == null ? "" : String(product.premiumPriceCents / 100)),
    [resellerPrice, setResellerPrice] = useState(optionalCentsToInput(product?.resellerPriceCents)),
    [cost, setCost] = useState(
      product?.costCents == null ? "" : String(product.costCents / 100),
    ),
    [image, setImage] = useState(product?.imageUrl ?? "");
  const pricing = product?.pricing;
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
      priceCents: Math.round(publicPrice * 100),
      priceVisibility: f.get("priceVisibility"),
      normalPriceCents: Math.round(normalPrice * 100),
      premiumPriceCents: premiumPrice === "" ? null : Math.round(Number(premiumPrice) * 100),
      resellerPriceCents: optionalInputToCents(resellerPrice),
      costCents: cost === "" ? null : Math.round(Number(cost) * 100),
      pricingMode,
      manualPriceCents: pricingMode === "MANUAL" ? Math.round(price * 100) : null,
      categoryId: f.get("categoryId"),
      brandId: f.get("brandId") || null,
      imageUrl: image || null,
      downloadUrl: f.get("downloadUrl") || null,
      downloadLabel: f.get("downloadLabel") || null,
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
          <legend>Precificação BancadaSoft</legend>
          <div className="form-grid">
            <label>Preço Público (R$)<input type="number" min="0.01" step=".01" value={publicPrice} onChange={(event)=>setPublicPrice(Number(event.target.value))} required/></label>
            <label>Preço Técnico (R$)<input type="number" min="0.01" step=".01" value={normalPrice} placeholder="Usa preço Público" onChange={(event)=>setNormalPrice(Number(event.target.value))}/></label>
            <label>Preço Premium (R$)<input type="number" min="0.01" step=".01" value={premiumPrice} placeholder="Usa preço Técnico" onChange={(event)=>setPremiumPrice(event.target.value)}/></label>
            <label>Preço de revenda (R$)<input type="number" min="0.01" step=".01" value={resellerPrice} placeholder="Vazio = não vendido a revendedor" onChange={(event)=>setResellerPrice(event.target.value)}/></label>
          </div>
          <div className="form-grid">
            <label>Exibir preço publicamente<select name="priceVisibility" defaultValue={product?.priceVisibility ?? "PUBLIC"}><option value="PUBLIC">Sim</option><option value="LOGIN_REQUIRED">Não · somente cadastrados</option></select></label>
          </div>
          <div className="form-grid">
            <label>
              Modo de preço
              <select value={pricingMode} onChange={(event) => setPricingMode(event.target.value as typeof pricingMode)}>
                <option value="AUTO_GLOBAL">Automático · regra global</option>
                <option value="AUTO_GROUP">Automático · regra do grupo</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
            <label>
              Preço manual final (R$)
              <input
                type="number"
                min="0.01"
                step=".01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                disabled={pricingMode !== "MANUAL"}
              />
              {pricingMode === "MANUAL" && <small>PREÇO MANUAL · protegido contra sincronizações</small>}
            </label>
          </div>
          {pricing ? <div className="pricing-summary-grid">
            <article><small>CUSTO ORIGINAL</small><b>{pricing.providerCostCents == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: pricing.providerCurrency ?? "USD" }).format(pricing.providerCostCents / 100)}</b><span>{pricing.providerCurrency ?? "Sem moeda"}</span></article>
            <article><small>CÂMBIO CONFIGURADO</small><b>{pricing.exchangeRateMicros == null ? "—" : (pricing.exchangeRateMicros / 1_000_000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</b><span>buffer {(pricing.exchangeBufferBps / 100).toFixed(2)}%</span></article>
            <article><small>CUSTO CONVERTIDO</small><b>{brl(pricing.providerCostBrlCents)}</b><span>BRL</span></article>
            <article><small>REGRA AUTOMÁTICA</small><b>{pricing.appliedRule}</b><span>{pricing.roundingMode}</span></article>
            <article><small>PREÇO SUGERIDO</small><b>{brl(pricing.suggestedPriceCents)}</b><span>{pricing.pricingStatus}</span></article>
            <article><small>PREÇO EFETIVO</small><b>{brl(pricing.effectivePriceCents)}</b><span>{pricingMode === "MANUAL" ? "PREÇO MANUAL" : "AUTOMÁTICO"}</span></article>
            <article><small>LUCRO ESTIMADO</small><b>{brl(pricing.estimatedProfitCents)}</b><span>taxa {brl(pricing.paymentFeeCents)}</span></article>
            <article><small>MARGEM SOBRE VENDA</small><b>{pricing.estimatedMarginBps == null ? "—" : `${(pricing.estimatedMarginBps / 100).toFixed(2)}%`}</b><span>alvo {(pricing.targetMarginBps / 100).toFixed(2)}%</span></article>
          </div> : <p className="security-note">Vincule um fornecedor operacional e configure o motor para calcular a sugestão.</p>}
          <small className="pricing-help">A sugestão é recalculada após salvar. Preços manuais nunca são substituídos automaticamente.</small>
        </fieldset>
        <fieldset>
          <legend>Controles comerciais</legend>
          <div className="form-grid">
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
          <legend>Download</legend>
          <div className="form-grid">
            <label>
              Link oficial para download
              <input
                name="downloadUrl"
                type="url"
                placeholder="https://..."
                defaultValue={product?.downloadUrl ?? ""}
              />
            </label>
            <label>
              Texto do botão
              <input
                name="downloadLabel"
                placeholder="Baixar ferramenta"
                maxLength={60}
                defaultValue={product?.downloadLabel ?? ""}
              />
            </label>
          </div>
          <small className="pricing-help">
            Link público apenas para baixar o instalador/software. Não faz parte
            da entrega comercial e não depende de pagamento ou fulfillment.
          </small>
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
      {product ? <VariantManager productId={product.id} variants={product.variants} providerOptions={providerOptions}/> : null}
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
